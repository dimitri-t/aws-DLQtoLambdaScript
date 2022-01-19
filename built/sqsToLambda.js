"use strict";
//TODO Pull the params from temacity environment variables
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const AWS = __importStar(require("aws-sdk"));
// Handle command line args for region, queue, lambda
if (process.argv.length !== 6)
    throw ('Usage:\n    script <accountID> <awsRegion> <dlqName> <lambdaName>');
const accountId = process.argv[2];
const awsRegion = process.argv[3];
const queueName = process.argv[4];
const lambdaName = process.argv[5];
AWS.config.update({ region: awsRegion });
console.log(accountId, awsRegion, queueName, lambdaName);
console.log(process.argv);
console.log(process.env);
// Create SQS service client
const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });
// Create Lambda service client
const lambda = new AWS.Lambda({ apiVersion: '2015-03-31' });
const main = async () => {
    // Keeping track of how many messages we pull and process
    let totalMessagesReceived = 0;
    let totalMessagesReprocessed = 0;
    const failedMessages = [];
    console.log('Fetching Messages from SQS Queue \n');
    // Params for receiving a message from SQS
    const receiveMessageRequest = {
        QueueUrl: `https://sqs.${awsRegion}.amazonaws.com/${accountId}/${queueName}`,
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
                    FunctionName: lambdaName,
                    InvocationType: 'Event',
                    Payload: JSON.stringify(currMessage.Body),
                };
                console.log('Invoking Lambda Function: ', lambdaInvocationParams.FunctionName, ' with Payload ', lambdaInvocationParams.Payload);
                const response = await lambda.invoke(lambdaInvocationParams).promise();
                if (response.StatusCode === 202) {
                    // Delete message from Queue
                    console.log('Lambda succesfully invoked\nDeleting Message from the Queue');
                    const deleteMessageParams = {
                        QueueUrl: `https://sqs.${awsRegion}.amazonaws.com/${accountId}/${queueName}`,
                        ReceiptHandle: currMessage.ReceiptHandle
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
};
(async () => await main())();
