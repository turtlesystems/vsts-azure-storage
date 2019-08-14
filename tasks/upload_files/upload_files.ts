// Import necessary tasks
import * as tl from "azure-pipelines-task-lib/task";
import * as task from "./common/TaskConfiguration";
import * as resources from "./common/AzureResources";
import * as path from "path";
import {sprintf} from "sprintf-js";

// Create function to perform the upload
function run(): Promise<void> {

    // get the task parameters from settings
    let azureSAUploadTaskParameters = new task.TaskParameters();

    return azureSAUploadTaskParameters.getTaskParameters().then((taskParameters) => {

        // instantiate necessary classes
        let azureResources = new resources.AzureResources(taskParameters);

        // based on the action call the most appropriate operation
        switch (taskParameters.action) {
            case "create":

                // call method which will determine if the resource group needs creating
                // as well as the storage account
                return azureResources.createResources();

            case "delete":

                return azureResources.deleteResources();
            default:
                throw tl.loc("InvalidAction", taskParameters.action);
        }
    });

}

// Set the path to the task manifest so that messages can be found
let taskManifestPath = path.join(__dirname, "task.json");
tl.debug(sprintf("Setting resource path: %s", taskManifestPath));
tl.setResourcePath(taskManifestPath);

run().then((result) =>
    tl.setResult(tl.TaskResult.Succeeded, "")
).catch((error) =>
    tl.setResult(tl.TaskResult.Failed, error)
);