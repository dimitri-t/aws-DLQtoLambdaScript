import AWS from 'aws-sdk';
import { GetFunctionConfigurationRequest, UpdateFunctionConfigurationRequest } from 'aws-sdk/clients/lambda';

const lambda = new AWS.Lambda({
    apiVersion: '2015-03-31',
    region: 'ap-southeast-2',
});

let retryCount = 0;

// These are set from the TeamCity Pipeline
const env = process.env.ENVIRONMENT!;
const retryLimitStr = process.env.UPDATE_FUNCTION_CONFIGURATION_RETRY_LIMIT!;
const retryBackoffExponentBaseStr = process.env.UPDATE_FUNCTION_CONFIGURATION_RETRY_EXPONENT_BASE!;

const retryLimit = parseInt(retryLimitStr);
const retryBackoffExponentBase = parseInt(retryBackoffExponentBaseStr);

const args = process.argv.slice(2);
console.log('Arguments: ', args);
(async () => await updateEnvironmentVariable(args[0], args[1], args[2]))();

async function updateEnvironmentVariable(lambdaFunctionName: string, envVarName: string, envVarValue: string) {
    process.env.AWS_PROFILE = `rfs${env}`;
    console.info(`Running against ${env} AWS account`);

    const params: GetFunctionConfigurationRequest = {
        FunctionName: lambdaFunctionName,
    };

    const lambdaFunctionConfiguration = await lambda.getFunctionConfiguration(params).promise();

    const environment = lambdaFunctionConfiguration.Environment || ({
        Variables: {}
    });

    if (environment.Variables) {
        environment.Variables[envVarName] = envVarValue;
    } else {
        environment.Variables = {
            [envVarName]: envVarValue,
        };
    }

    const updateFunctionConfigurationRequest: UpdateFunctionConfigurationRequest = {
        FunctionName: lambdaFunctionName,
        Environment: environment,
    }

    await updateFunctionConfiguration(updateFunctionConfigurationRequest);
}

const updateFunctionConfiguration = async (request: UpdateFunctionConfigurationRequest) => {
    try {
        console.info('Attempting to update function configuration...');
        await lambda.updateFunctionConfiguration(request).promise();
        console.info('Updated Function Configuration successfully');
    } catch (err: any) {
        console.log('Error occurred updating function Configuration: %o', err);
        console.log('Error code: %s', err.code);
        if (err.code === 'ResourceConflictException' && retryCount < retryLimit) {
            console.warn('ResourceConflictException occurred. Backing off and retrying...');
            await exponentialBackoff(retryBackoffExponentBase, retryCount);
            ++retryCount;
            await updateFunctionConfiguration(request);
        } else {
            throw err;
        }
    }
};

const timeout = (milliseconds: number) => {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
};

const exponentialBackoff = async (exponentBase: number, retryCount: number): Promise<any> => {
    const waitMs = exponentBase ** retryCount;
    console.debug(`Waiting for ${waitMs} milliseconds...`);
    await timeout(waitMs);
};