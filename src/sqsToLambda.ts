import * as AWS from 'aws-sdk';

// Handle command line args for region, queue, lambda
if (process.argv.length !== 5) throw ('Usage:\n    script <awsRegion> <dlqName> <lambdaName>');

const awsRegion = process.argv[2]
const queueName = process.argv[3];
const lambdaName = process.argv[4];

AWS.config.update({ region: awsRegion });

// Create SQS service client
const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });

// Create Lambda service client
const lambda = new AWS.Lambda({ apiVersion: '2015-03-31' });

const main = async () => {

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

    console.log('Fetching Messages from SQS Queue \n');

    // Params for receiving a message from SQS
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
            console.log(currMessage);

            console.log('Received: MessageID ', currMessage.MessageId);

            try {
                const lambdaInvocationParams = {
                    FunctionName: lambdaName, /* required */
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

                    const deleteResponse = await sqs.deleteMessage(deleteMessageParams).promise();
                    console.log('Message deleted succesfully\n\n', deleteResponse);

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
    console.log('\n\nTotal messages received: ', totalMessagesReceived);
    console.log('Total messages reprocessed succesfully: ', totalMessagesReprocessed);
    console.log('Failed messages: ', failedMessages);
}

(async () => await main())();
