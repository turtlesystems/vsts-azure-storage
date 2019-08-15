/**
 * Class to handle the maintenance of resource groups for the task
 *
 * @author Russell Seymour
 */

// Include necessary libraries
import * as tl from "azure-pipelines-task-lib/task";
import { ResourceManagementClient } from "azure-arm-resource";
import { StorageManagementClient } from "@azure/arm-storage";
import { StorageAccountCreateParameters, SkuName } from "@azure/arm-storage/esm/models";
import * as azureStorage from "azure-storage";

import * as task from "./TaskConfiguration";
import {Utils} from "./Utils";
import {sprintf} from "sprintf-js";

export class AzureResources {

    // configure properties
    private taskParameters: task.TaskParameters;
    private ResourceManagementClient;
    private StorageManagementClient;
    private BlobService;

    constructor(taskParameters: task.TaskParameters) {
        this.taskParameters = taskParameters;
        this.ResourceManagementClient = ResourceManagementClient;
        this.StorageManagementClient = StorageManagementClient;
    }

    /**
     * Method to determine which resources need creating
     */
    public async createResources(): Promise<void> {
        // login to get the necessary client
        let rmClient = new this.ResourceManagementClient(this.taskParameters.credentials, this.taskParameters.subscriptionId);
        let smClient = new this.StorageManagementClient(this.taskParameters.azureCredentials, this.taskParameters.subscriptionId);

        try {
            await this.createResourceGroupIfRequired(rmClient);
        } catch (err) {
            tl.setResult(tl.TaskResult.Failed, err);
            return;
        }

        await this.createStorageAccountIfRequired(smClient);
        await this.createContainerIfRequired(smClient);
        let sasDetails = await this.createSASToken(smClient);

        // upload the files in the specified directory
        try {
            await this.uploadFilesToContainer();
        } catch (err) {
            tl.setResult(tl.TaskResult.Failed, err);
            return;
        }

        // return the SAS token to the calling function
        console.log(tl.loc("SASToken", sasDetails[0]));

        // if the vsts variable name is not null then populate it
        if (this.taskParameters.vstsSasTokenVariableName != null) {
            tl.setVariable(this.taskParameters.vstsSasTokenVariableName, sasDetails[0]);

            // append URl to the end of the variable so that that can be picked up as well
            let url_var = sprintf("%s_URL", this.taskParameters.vstsSasTokenVariableName);
            tl.setVariable(url_var, sasDetails[1]);
        }
    }

    /**
     * Method to delete the specified resources
     */
    public async deleteResources(): Promise<void> {
        // Get the necessary client
        let rmClient = new this.ResourceManagementClient(this.taskParameters.credentials, this.taskParameters.subscriptionId);

        // Perform the delete in the resource group
        await this.deleteResourceGroupIfExists(rmClient);
    }

    /**
     * Create the resource group if required
     * In this case it means if it does not already exist
     */
    private async createResourceGroupIfRequired(client: ResourceManagementClient.ResourceManagementClient) {
        let exists = await this.checkResourceGroupExists(client);

        // if the resource group does not exist, create it
        if (!exists) {
            await this.createResourceGroup(client);
        }
    }

    /**
     * Delete the named resource group, if it exists
     */
    private async deleteResourceGroupIfExists(client: ResourceManagementClient.ResourceManagementClient) {
        let exists = await this.checkResourceGroupExists(client);

        // if the resource group exists, remove it
        if (exists) {
            await this.deleteResourceGroup(client);
        }
    }

    /**
     * Determine if the named resource group exists or not
     */
    private checkResourceGroupExists(client: ResourceManagementClient.ResourceManagementClient): Promise<boolean>  {
        console.log(tl.loc("CheckResourceGroupExists", this.taskParameters.resourceGroupName));
        return new Promise<boolean>((resolve, reject) => {
            client.resourceGroups.checkExistence(this.taskParameters.resourceGroupName, (error, exists, request, response) => {
                if (error) {
                    return reject(tl.loc("ResourceGroupStatusFetchFailed", Utils.getError(error)));
                }
                console.log(tl.loc("ResourceGroupStatus", exists));
                resolve(exists);
            });
        });
    }

    /**
     * Private method to create the resource group if it is required
     */
    private async createResourceGroup(client: ResourceManagementClient.ResourceManagementClient): Promise<void> {
        return new Promise<void> ((resolve, reject) => {
            console.log(tl.loc("CreatingNewRG", this.taskParameters.resourceGroupName));

            // define the parameters that need to be passed
            let parameters = {
                "name": this.taskParameters.resourceGroupName,
                "location": this.taskParameters.location
            };

            client.resourceGroups.createOrUpdate(this.taskParameters.resourceGroupName, parameters, (error, result, request, response) => {
                if (error) {
                    return reject(tl.loc("ResourceGroupCreationFailed", Utils.getError(error)));
                }
                console.log(tl.loc("CreatedRG"));
                resolve();
            });
        });
    }

    /**
     * Private method to delete the resource group if it exists
     */
    private async deleteResourceGroup(client: ResourceManagementClient.ResourceManagementClient): Promise<void> {
        return new Promise<void> ((resolve, reject) => {
            console.log(tl.loc("DeletingRG", this.taskParameters.resourceGroupName));

            client.resourceGroups.deleteMethod(this.taskParameters.resourceGroupName, (error, result, request, response) => {
                if (error) {
                    return reject(tl.loc("ResourceGroupDeletionFailed", Utils.getError(error)));
                }
                console.log(tl.loc("DeletedRG"));
                resolve();
            });
        });
    }

    /**
     * Determine if the storage account should be created or not
     *
     * This will only check for existence, will need to find a way to see if it is owned by
     * the subscription and therefore if it is writeable
     */
    private async createStorageAccountIfRequired(client: StorageManagementClient) {
        let exists = await this.checkStorageAccountExists(client);

        // if the account does not exist create it
        // but if it does exist attempt to "get" it as it might not belong to us
        if (!exists) {
            await this.createStorageAccount(client);
        }
    }

    private async checkStorageAccountExists(client: StorageManagementClient) {
        console.log(tl.loc("CheckStorageAccountExists", this.taskParameters.storageAccountName));
        return new Promise<boolean>((resolve, reject) => {

            client.storageAccounts.checkNameAvailability(this.taskParameters.storageAccountName, (error, exists) => {
                if (error) {
                    if (this.taskParameters.isDev) {
                        console.log(Utils.getError(error));
                    }
                    return reject(tl.loc("StorageAccountStatusFetchFailed", Utils.getError(error)));
                }
                console.log(tl.loc("StorageAccountStatus", exists.nameAvailable, exists.reason));
                resolve(!exists.nameAvailable);
            });
        });

    }

    private async createStorageAccount(client: StorageManagementClient) {

        let result;

        // Create the parameters for the new storage account
        let parameters: StorageAccountCreateParameters = {
            "location": this.taskParameters.location,
            "sku": {
                "name": <SkuName> this.taskParameters.storageAccountType,
            },
            "kind": "Storage"
        };

        console.log(tl.loc("CreatingNewSA", this.taskParameters.storageAccountName));

        try {
            result = await client.storageAccounts.create(this.taskParameters.resourceGroupName,
                            this.taskParameters.storageAccountName,
                            parameters,
                            {});
        } catch (err) {
            tl.error(tl.loc("StorageAccountCreationFailed", Utils.getError(err)));
        }

        console.log(tl.loc("CreatedSA"));
    }

    private async createContainerIfRequired(client: StorageManagementClient) {

        let exists = await this.checkContainerExists(client);

        // create the container if it does not exist
        if (!exists) {
            await this.createContainer(client);
        }
    }

    private async checkContainerExists(client: StorageManagementClient) {
        console.log(tl.loc("CheckStorageAccountContainerExists", this.taskParameters.containerName));
        return new Promise<boolean>((resolve, reject) => {
            client.blobContainers.get(this.taskParameters.resourceGroupName,
                                       this.taskParameters.storageAccountName,
                                       this.taskParameters.containerName,
                                       {},
                                       (error, result, request, response) => {

                let exists: boolean;

                if (!error) {
                    exists = true;
                } else {
                    if (error.message.startsWith("The specified container does not")) {
                        exists = false;
                    } else {
                        return reject(tl.loc("StorageAccountContainerListFailed", Utils.getError(error)));
                    }
                }

                console.log(tl.loc("ContainerStatus", exists));
                resolve(exists);
            });
        });
    }

    private async createContainer(client: StorageManagementClient): Promise<void> {
        return new Promise<void> ((resolve, reject) => {
            console.log(tl.loc("CreatingContainer", this.taskParameters.containerName));

            client.blobContainers.create(this.taskParameters.resourceGroupName, this.taskParameters.storageAccountName, this.taskParameters.containerName, {}, (error, result, request, response) => {
                if (error) {
                    return reject(tl.loc("ContainerCreationFailed", Utils.getError(error)));
                }
                console.log(tl.loc("CreatedContainer"));
                resolve();
            });
        });
    }

    private async createSASToken(client: StorageManagementClient): Promise<Array<string>> {

        // get the key for the storage account
        let sakeys = await client.storageAccounts.listKeys(this.taskParameters.resourceGroupName, this.taskParameters.storageAccountName, {});

        // get the frst key
        let key = sakeys.keys[0].value;

        // create a blob service so that the SAS token can be created
        this.BlobService = azureStorage.createBlobService(this.taskParameters.storageAccountName, key);

        // define the dates for the start and expiry
        let startDate = new Date();
        let expiryDate = new Date(startDate);

        // set the options for displaying the date
        let date_options = { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric"};

        // set the start date a few minutes behind to allow for clock drift
        startDate.setMinutes(startDate.getMinutes() - this.taskParameters.sasTokenStartTime);
        console.log(tl.loc("SASTokenStart", startDate.toLocaleString("en-GB", date_options)));

        // set the expiry date so it is 24 hours ahead
        expiryDate.setMinutes(startDate.getMinutes() + this.taskParameters.sasTokenExpiryTime);
        console.log(tl.loc("SASTokenExpiry", expiryDate.toLocaleString("en-GB", date_options)));

        // build up the policy for the token
        let policy = {
            AccessPolicy: {
                Permissions: azureStorage.BlobUtilities.SharedAccessPermissions.READ,
                Start: startDate,
                Expiry: expiryDate
            }
        };

        // now create the sas token
        let token = this.BlobService.generateSharedAccessSignature(this.taskParameters.containerName, null, policy);

        let shared = azureStorage.createBlobServiceWithSas(this.BlobService.host, token);
        let url = shared.getUrl(this.taskParameters.containerName, this.taskParameters.storageAccountName, token);

        return [token, url];
    }

    private async uploadFilesToContainer(): Promise<void> {
        return new Promise<void> ((resolve, reject) => {
            // Display the path from which files will be uploaded
            console.log(sprintf("Uploading files from directory: %s", this.taskParameters.uploadDirectory));

            // get all the files in the specified directory to build up
            // a list of the files that need to be uploaded
            let items = tl.find(this.taskParameters.uploadDirectory);

            tl.debug(sprintf("Files to upload: %d", items.length));

            // iterate around the items that have been returned
            let stat;
            let name;
            for (let item of items) {

                // continue onto the next item if this one is a directory
                stat = tl.stats(item);
                if (stat.isDirectory()) {
                    continue;
                }

                // the item is a file, so upload it to the container
                // derive the name for the blob, this needs to be based from the upload directory so that the
                // nested directory structure is maintained in the container
                name = item.replace(/\\/g, "/");

                // check to see if the upload dir has a an ending '/' on it or not, if it does not add it
                let string_to_check = this.taskParameters.uploadDirectory;
                if (string_to_check.endsWith("/") === false) {
                    string_to_check += "/";
                }
                name = name.replace(string_to_check, "");

                // upload the item
                this.BlobService.createBlockBlobFromLocalFile(this.taskParameters.containerName, name, item, {}, (error, result) => {
                    if (error) {
                        return reject(tl.loc("UploadFileToContainerFailed", Utils.getError(error)));
                    } else {
                        console.log(tl.loc("BlobUploaded", result.name));
                        resolve();
                    }
                });
            }
        });
    }
}
