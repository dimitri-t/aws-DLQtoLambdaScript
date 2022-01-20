import * as AWS from 'aws-sdk';

// Get inputs from ENV variables
const awsRegion = process.env.AWS_REGION!;
const queueName = process.env.SQS_NAME!;
const lambdaName = process.env.LAMBDA_NAME!;
const MaxNumberOfMessages = parseInt(process.env.SQS_MAX_NUM_MESSAGES!);
const VisibilityTimeout = parseInt(process.env.SQS_VISIBILITY_TIMEOUT!);
const WaitTimeSeconds = parseInt(process.env.SQS_WAIT_TIME_SECONDS!);

AWS.config.update({ region: awsRegion });

// Create SQS service client
const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });

// Create Lambda service client
const lambda = new AWS.Lambda({ apiVersion: '2015-03-31' });

const main = async () => {

    console.log(`Executing script with the following inputs\nAWS Region: ${awsRegion}\nSQS Queue: ${queueName}\nLambda Function: ${lambdaName}\n`);
    const startTime = Date.now();
    // Get Queue URL
    const getQueueUrlParams = {
        QueueName: queueName
    };
    const queueUrl = (await sqs.getQueueUrl(getQueueUrlParams).promise()).QueueUrl;
    if (!queueUrl) {
        console.log("Didn't find a queue URL for the specified SQS Queue");
        return;
    }

    // Keeping track of how many messages we pull and process
    let totalMessagesReceived = 0;
    let totalMessagesReprocessed = 0;
    let totalMessagesNotReprocessed = 0;
    const failedMessages = [];

    console.log(`Fetching Messages from SQS Queue \nSQS URL - ${queueUrl}\n`);

    // Params for receiving a message from SQS
    const receiveMessageRequest = {
        QueueUrl: queueUrl!,
        MaxNumberOfMessages: MaxNumberOfMessages,
        VisibilityTimeout: VisibilityTimeout,
        WaitTimeSeconds: WaitTimeSeconds,
        AttributeNames: ['All']
    };

    let Messages = (await sqs.receiveMessage(receiveMessageRequest).promise()).Messages;
    if (!Messages) {
        console.log('No Messages received from queue \n');
        return;
    }
    while (Messages && Messages.length > 0) {
        totalMessagesReceived += Messages.length;

        // For each Message invoke lambda fnc
        for (const currMessage of Messages) {

            console.log(`MessageID: ${currMessage.MessageId}`);
            console.log(`Message Body: ${currMessage.Body}`);

            // Retrieve Message time sent or set it to a time after the process started
            const messageTimeSent = currMessage.Attributes?.SentTimestamp ?
                parseInt(currMessage.Attributes?.SentTimestamp)
                : startTime + 1;
            if (messageTimeSent > startTime) {
                console.warn(`Message was sent after reprocessing began: ${currMessage.MessageId}\nWill not reprocess this message`);
                totalMessagesNotReprocessed++;
            } else {
                // Invoke Lambda Function with the body of the current message
                // If it is succesfully invoked, delete it from the queue
                try {
                    const lambdaInvocationParams = {
                        FunctionName: lambdaName,
                        InvocationType: 'Event',
                        Payload: currMessage.Body,
                    }
                    console.log('Invoking Lambda Function: ', lambdaInvocationParams.FunctionName, ' with Payload ', lambdaInvocationParams.Payload);

                    const response = await lambda.invoke(lambdaInvocationParams).promise();

                    if (response.StatusCode === 202) {
                        // Delete message from Queue
                        console.log('Lambda succesfully invoked\nDeleting Message from the Queue');

                        const deleteMessageParams = {
                            QueueUrl: queueUrl!,
                            ReceiptHandle: currMessage.ReceiptHandle!
                        };

                        await sqs.deleteMessage(deleteMessageParams).promise();
                        console.log('Message deleted succesfully\n');

                        totalMessagesReprocessed++;
                    }
                }
                catch (err) {
                    // Message encountered an error
                    console.error(currMessage.MessageId, err);
                    failedMessages.push(currMessage.MessageId);
                }
            }
        }
        Messages = (await sqs.receiveMessage(receiveMessageRequest).promise()).Messages;
    }
    console.log('Total messages received: ', totalMessagesReceived);
    console.log('Total messages reprocessed succesfully: ', totalMessagesReprocessed);
    console.log('Total messages not reprocessed: ', totalMessagesNotReprocessed);
    console.log('Failed messages: ', failedMessages);
}

(async () => await main())();
