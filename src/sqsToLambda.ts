import * as AWS from 'aws-sdk';

// Get inputs from ENV variables
const awsRegion = process.env.AWS_REGION!;
const queueName = process.env.SQS_NAME!;
const lambdaName = process.env.LAMBDA_NAME!;

// const awsRegion = 'ap-southeast-2';
// const queueName = 'testQueue';
// const lambdaName = 'testLambda';

AWS.config.update({ region: awsRegion });

// Create SQS service client
const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });

// Create Lambda service client
const lambda = new AWS.Lambda({ apiVersion: '2015-03-31' });

const main = async () => {

    console.log(`Executing script with the following inputs\nAWS Region: ${awsRegion}\nSQS Queue: ${queueName}\nLambda Function: ${lambdaName}\n`);

    // Get Queue URL
    const getQueueUrlParams = {
        QueueName: queueName
    };
    let queueUrl = (await (await sqs.getQueueUrl(getQueueUrlParams).promise()).QueueUrl);
    if (!queueUrl) {
        console.log("Didn't find a queue URL for the specified SQS Queue");
        return;
    }

    // Keeping track of how many messages we pull and process
    let totalMessagesReceived = 0;
    let totalMessagesReprocessed = 0;
    const failedMessages = [];

    console.log(`Fetching Messages from SQS Queue \nSQS URL - ${queueUrl}\n`);

    // Params for receiving a message from SQS

    //      Do we want these params as ENV Variables???
    const receiveMessageRequest = {
        QueueUrl: queueUrl!,
        MaxNumberOfMessages: 10,
        VisibilityTimeout: 40,
        WaitTimeSeconds: 15,
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

            // Invoke Lambda Function with the body of the current message
            // If it is succesfully invoked, delete it from the queue
            try {
                const lambdaInvocationParams = {
                    FunctionName: lambdaName,
                    InvocationType: 'Event',
                    Payload: JSON.stringify(currMessage.Body),
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
        Messages = (await sqs.receiveMessage(receiveMessageRequest).promise()).Messages;
    }
    console.log('Total messages received: ', totalMessagesReceived);
    console.log('Total messages reprocessed succesfully: ', totalMessagesReprocessed);
    console.log('Failed messages: ', failedMessages);
}

(async () => await main())();
