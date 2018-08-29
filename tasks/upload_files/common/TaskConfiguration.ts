/**
 * Class to return all the settings that have been specified on the task
 * 
 * @author Russell Seymour
 */

// Include necessary libraries
import * as tl from "vsts-task-lib/task";
import * as msRestAzure from "ms-rest-azure";
import {sprintf} from "sprintf-js";
import * as toTime from "to-time"

export class TaskParameters {
    public action: string;
    public subscriptionId: string;
    public resourceGroupName: string;
    public location: string;
    public credentials: msRestAzure.ApplicationTokenCredentials;
    public storageAccountName: string;
    public storageAccountType: string = "Standard_LRS";
    public containerName: string;
    public uploadDirectory: string;
    public isDev: boolean = false;
    public sasTokenStartTime: number;
    public sasTokenExpiryTime: number;
    public vstsSasTokenVariableName: string;

    /**
     * Use the specified connected service to get the information to build up the credentials
     * that are required to communicate with Azure
     */
    private async getCredentials(connectedService: string): Promise<msRestAzure.ApplicationTokenCredentials> {

        // interrogate the connected service to get the SPN details
        let clientId: string = this.getValue("servicePrincipalId", false, "authorisation", connectedService);
        let clientSecret: string = this.getValue("servicePrincipalKey", false, "authorisation", connectedService);
        let tenantId: string = this.getValue("tenantId", false, "authorisation", connectedService);

        let credentials = new msRestAzure.ApplicationTokenCredentials(clientId, tenantId, clientSecret);

        return credentials;
    }

    /**
     * Return this class with all the task parameters that have been specified
     * 
     * If this is DEV mode then get all the settings from environment variables
     */
    public async getTaskParameters() : Promise<TaskParameters> {

        // determine if in DEV mode
        this.isDev = process.env['NODE_ENV'] && process.env['NODE_ENV'].toUpperCase() == 'DEV' ? true : false
        
        try {

            let connectedService = this.getValue("ConnectedServiceName", true, "input")
            this.subscriptionId = this.getValue("SubscriptionId", true, "data", connectedService);
            this.credentials = await this.getCredentials(connectedService)

            // Populate the class properties with task parameters
            this.resourceGroupName =  this.getValue("resourceGroupName", true, "input");
            this.action = this.getValue("action", false, "input")
            this.location = this.getValue("location", false, "input")
            this.containerName = this.getValue("containerName", false, "input")
            this.uploadDirectory = this.getValue("uploadDirectory", false, "input")
            this.storageAccountName = this.getValue("storageAccountName", false, "input");

            this.sasTokenStartTime = toTime(this.getValue("sasTokenStartTime", false, "input")).minutes()
            this.sasTokenExpiryTime = toTime(this.getValue("sasTokenExpiryTime", false, "input")).minutes()
            this.vstsSasTokenVariableName = this.getValue("vstsSasTokenVariableName", false, "input")

            return this;
        } catch (error) {
            throw new Error(tl.loc("ASTP_ConstructorFailed", error.message));
        }
    }

    private getValue(parameter: string, required: boolean, type: string = null, connectedService: string = null) {
        let value = ""
        if (this.isDev) {
            // get the value from the environment
            value = process.env[parameter.toUpperCase()]
        } else {

            // based on the type, select the task library method to call to get the requested value
            switch (type) {
                case "input":
                    // get the value from the task
                    value = tl.getInput(parameter, required)
                    break;
                case "data":
                    // get the value from the endpoint
                    value = tl.getEndpointDataParameter(connectedService, parameter, required)
                    break;
                case "authorisation":
                    // get the authorisation data
                    value = tl.getEndpointAuthorizationParameter(connectedService, parameter, required)
                    break;
                default:
                    throw new Error(sprintf("Input Type has not been specified: %s", parameter))
            }
        }
        return value
    }

}