sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/util/File",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox"
],
	/**
	 * @param {typeof sap.ui.core.mvc.Controller} Controller
	 */
    function (Controller, File, JSONModel, MessageBox) {
        "use strict";

        return Controller.extend("ain.massupload.controller.App", {
            /** 
             * Function that is called on init, used to initalize resource bundle
             */
            onInit: function () {
                this.resourceBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
            },

            /** 
             * Function to build headers of the Cloud API based on API key
             * @param sApi
             * @returns API headers
             */
            getHeader: function (sApi) {
                return {
                    "APIKey": this.resourceBundle.getText(sApi),
                    "DataServiceVersion": "2.0",
                    "Accept": "*/*",
                    "Content-Type": "application/json"
                };
            },

            /**
             * Getter for text from resource bundle.
             * @public
             * @returns Text from {sap.ui.model.resource.ResourceModel} the resourceModel of the component
             */
            getBundleText: function (sId, sParameter) {
                return this.resourceBundle.getText(sId, sParameter);
            },

            /** 
             * Function that binds the return data to table and set off busy dialog
             * @param oReturn
             */
            setReturnTable: function (oReturn) {
                var oReturnResults = new JSONModel();
                var oData = {
                    data: oReturn
                };
                oReturnResults.setData(oData);
                var oTable = this.getView().byId("resultsTable");
                oTable.setModel(oReturnResults);
                this.getView().setBusy(false);
            },

            /** 
             * Function that converts uploaded CSV to JSON Model
             * @returns Binds the status of each item in excel
             */
            onUploadDialogPress: function () {
                this.getView().setBusy(true);
                var sSelectedBtn = this.getView().byId("rbg1").getSelectedButton().getText();
                var fU = this.getView().byId("fileUploader");
                var domRef = fU.getFocusDomRef();
                var file = domRef.files[0];
                if (!file.name.includes("csv")) {
                    MessageBox.error(this.getBundleText("csvErr"));
                    this.getView().setBusy(false);
                    return;
                }

                // Create a File Reader object
                var reader = new FileReader();

                var that = this;
                reader.onload = function (e) {
                    var strCSV = e.target.result;
                    var lines = strCSV.split("\n");

                    if (lines[lines.length - 1] === "") {
                        lines.pop();
                    }

                    var result = [];
                    // replace all additional excel column values
                    lines[0] = lines[0].replace("(AG-A/Mod-M)", "");
                    lines[0] = lines[0].replaceAll("\\r", "");
                    lines[0] = lines[0].replace(/[*]/g, "");
                    lines[0] = lines[0].replace("(AG1|AG2..)", "");
                    var headers = lines[0].split(",");
                    for (var i = 1; i < lines.length; i++) {
                        var obj = {};
                        var currentline = lines[i].split(",");
                        for (var j = 0; j < headers.length; j++) {
                            obj[headers[j]] = currentline[j];
                        }
                        result.push(obj);
                    }
                    var oStringResult = JSON.stringify(result);
                    var oStringData = oStringResult.replaceAll("\\r", "");
                    var oFinalResult = JSON.parse(oStringData);
                    if (!oFinalResult.length > 0) {
                        MessageBox.error(that.getBundleText("csvEmpty"));
                        that.getView().setBusy(false);
                        return;
                    }
                    // Bind the data to the Table				
                    var oModel = new sap.ui.model.json.JSONModel();
                    oModel.setData(oFinalResult);
                    if (sSelectedBtn === "Model") {
                        that.postModel(oModel).then(function (oReturn) {
                            that.postAttribute(oModel).then(function (oAReturn) {
                                var oFReturn = oReturn.concat(oAReturn);
                                that.setReturnTable(oFReturn);
                            });
                        });
                    } else if (sSelectedBtn === "Model Template") {
                        that.postModelTemplate(oModel).then(function (oReturn) {
                            that.setReturnTable(oReturn);
                        });
                    }
                };
                reader.readAsBinaryString(file);
            },

            /** 
             * Function that will generate CSV template for Model and Model Template Upload
             */
            downloadCSV: function () {
                //Get text of Selected Radio button
                var sSelectedBtn = this.getView().byId("rbg1").getSelectedButton().getText();
                if (sSelectedBtn === "Model") {
                    //Build CSV template for download
                    var sTemplate = "Type(AG-A/Mod-M)*,ModelID*,TemplateID*,Manufacturer*,Description*,LongDesc,AttributeGroup,AttributeId,Value,UOM";
                    var sTempalteName = "Model";
                } else if (sSelectedBtn === "Model Template") {
                    //Build CSV template for download
                    sTemplate = "TemplateID*,Description*,LongDesc,AttributeGroups(AG1|AG2..)*";
                    sTempalteName = "Model_Template";
                }
                // Use File save method to download csv
                File.save(sTemplate, sTempalteName, "csv", "text/csv");
            },

            /** 
             * Generate message based on oRow,msgType,msgText
             * @param oRow
             * @param msgType
             * @param msgText
             * @return message object
             */
            getReturnMsg: function (sId, sDesc, msgType, msgText) {
                return {
                    "ID": sId,
                    "Description": sDesc,
                    "Type": msgType,
                    "Message": msgText
                };
            },

            /** 
             * Function to post Model data to SAP Asset Intelligent Network cloud
             * @param oExcelData
             * @returns Status of all the rows uploaded in excel
             */
            postModel: function (oExcelData) {
                var that = this;
                return new Promise(function (fResolve) {
                    var aPromise = [];
                    // fetch all the line items of excel of type M
                    var oModels = oExcelData.getData().filter(function (entry) {
                        return entry.Type === 'M';
                    });

                    //Find Unique Models
                    var uniqueModels = oModels.filter((id, index, OData) => {
                        return OData.map(mapObj => mapObj.ModelID).indexOf(id.ModelID) === index;
                    });

                    for (var i = 0; i < uniqueModels.length; i++) {
                        // Filter excel data to find all the templates for a model
                        var oModelTemplates = oModels.filter((id) => {
                            return id.ModelID === uniqueModels[i].ModelID;
                        });

                        //initiallize template ID of unique models to array
                        uniqueModels[i].TemplateId = [];

                        //put all the template ID's to UniqueModels
                        for (var j = 0; j < oModelTemplates.length; j++) {
                            var atemplateId = {};
                            atemplateId.TemplateID = oModelTemplates[j].TemplateID;
                            uniqueModels[i].TemplateId.push(atemplateId);
                        }
                    }

                    for (var i = 0; i < uniqueModels.length; i++) {
                        var oRow = uniqueModels[i];
                        var oRPromise = that.postPModel(oRow);
                        aPromise.push(oRPromise);
                    }

                    //Wait till all the promises are resolved
                    //i.e wait till all rows are uploaded to AIN
                    Promise.all(aPromise).then(function (aReturn) {
                        fResolve(aReturn);
                    });
                });
            },

            /** 
             * Function that will run in loop to post Model to SAP AIN
             * @param oRow
             * @returns status for input row
             */
            postPModel: function (oRow) {
                var that = this;
                //Return Promise resolving message of posting
                return new Promise(function (fResolve) {
                    // fetch internal ID of all Templates
                    var aTpPromise = [];
                    for (var i = 0; i < oRow.TemplateId.length; i++) {
                        var oTpPromise = that.getTemplateInternal(oRow.TemplateId[i].TemplateID)
                        aTpPromise.push(oTpPromise);
                    }

                    Promise.all(aTpPromise).then(function (aTpReturn) {
                        // If any error occured while fetching internal Id of Template return
                        var oError = aTpReturn.filter(function (id) {
                            return id.type === that.getBundleText("msgTypeE");
                        });
                        if (oError.length > 0) {
                            fResolve(that.getReturnMsg(oRow.ModelID, oRow.Description, that.getBundleText("msgTypeE"), oError[0].message));
                        }

                        // Fetch internal ID of Organisation 
                        var oOrgPromise = that.getOrganisationInternal(oRow.Manufacturer);
                        oOrgPromise.then(function (aOrgReturn) {
                            // If any error occured while fetching internal Id of Organisation return
                            if (aOrgReturn.type === that.getBundleText("msgTypeE")) {
                                fResolve(that.getReturnMsg(oRow.ModelID, oRow.Description, that.getBundleText("msgTypeE"), aOrgReturn.message));
                            }

                            //Build Json Payload for model posting
                            var oPayloadData = {};
                            oPayloadData.internalId = oRow.ModelID;
                            oPayloadData.organizationID = aOrgReturn.data.IntOrgID;
                            oPayloadData.equipmentTracking = "1";
                            oPayloadData.modelType = "EQU";
                            oPayloadData.description = {};
                            oPayloadData.description.language = "en";
                            oPayloadData.description.short = oRow.Description;
                            oPayloadData.description.long = oRow.Description;
                            oPayloadData.templates = [];
                            for (var i = 0; i < aTpReturn.length; i++) {
                                var oTemplateInternal = {};
                                oTemplateInternal.id = aTpReturn[i].data.IntTemplateId;
                                // Assuming first template as primary template
                                if (i === 0) {
                                    oTemplateInternal.primary = true;
                                }
                                else {
                                    oTemplateInternal.primary = false;
                                }
                                // Push Template data to payload
                                oPayloadData.templates.push(oTemplateInternal);
                            }
                            var oPayload = JSON.stringify(oPayloadData);

                            // Post Model to AIN system
                            var oModModel = new JSONModel();
                            oModModel.loadData("v1/models", oPayload, true, "POST", null, false, that.getHeader("apiKey"));
                            oModModel.attachRequestCompleted(function (oModEvent) {
                                if (oModEvent.getParameters().success) {
                                    fResolve(that.getReturnMsg(oRow.ModelID, oRow.Description, that.getBundleText("msgTypeS"), that.getBundleText("messageSuccessUpl")));
                                } else {
                                    //Error Handling
                                    var sModResult = oModEvent.getParameters().errorobject.responseText;
                                    var oModResult = new JSONModel();
                                    oModResult.setJSON(sModResult);
                                    fResolve(that.getReturnMsg(oRow.ModelID, oRow.Description, that.getBundleText("msgTypeE"), oModResult.getData().errorMessages[0].errorMessage));
                                }
                            });
                        });
                    });
                });
            },

            /** 
             * function that will post template to AIN 
             * @param oExcelData
             * @returns Staus of all the items in excel
             */
            postModelTemplate: function (oExcelData) {
                var that = this;
                return new Promise(function (fResolve) {
                    var aPromise = [];

                    for (var i = 0; i < oExcelData.getData().length; i++) {
                        var oRow = oExcelData.getData()[i];
                        var oRPromise = that.postPModelTemplate(oRow);
                        aPromise.push(oRPromise);
                    }

                    //Wait till all the promises are resolved
                    //i.e wait till all rows are uploaded to AIN
                    Promise.all(aPromise).then(function (aReturn) {
                        fResolve(aReturn);
                    });
                });
            },

            /** 
             * Function to create template for each input row
             * @param oRow
             * @returns status of each row uploaded to AIN
             */
            postPModelTemplate: function (oRow) {
                var that = this;
                return new Promise(function (fResolve) {
                    var aPromise = [];
                    var aAttributes = oRow.AttributeGroups.split("|");
                    for (var i = 0; i < aAttributes.length; i++) {
                        var oRPromise = that.getAttributeGroup(aAttributes[i]);
                        aPromise.push(oRPromise);
                    }
                    Promise.all(aPromise).then(function (aReturn) {
                        // check if there is any error in 
                        var oError = aReturn.filter(function (id) {
                            return id.type === that.getBundleText("msgTypeE");
                        });
                        if (oError.length > 0) {
                            fResolve(that.getReturnMsg(oRow.TemplateID, oRow.Description, that.getBundleText("msgTypeE"), oError[0].message));
                        }

                        var oPayload = {};
                        oPayload.description = {};
                        oPayload.description.short = oRow.Description;
                        oPayload.description.long = oRow.LongDesc;
                        oPayload.internalId = oRow.TemplateID;
                        oPayload.type = "3";
                        oPayload.hasStructure = false;
                        oPayload.attributeGroups = [];
                        for (i = 0; i < aReturn.length; i++) {
                            var oAtt = {};
                            oAtt.id = aReturn[i].data.IntAttributeGroup;
                            oPayload.attributeGroups.push(oAtt);
                        }
                        oPayload = JSON.stringify(oPayload);

                        var oMtModel = new JSONModel();
                        oMtModel.loadData("v1/templates", oPayload, true, "POST", null, false, that.getHeader("apiKey"));
                        oMtModel.attachRequestCompleted(function (oMtEvent) {
                            if (oMtEvent.getParameters().success) {
                                fResolve(that.getReturnMsg(oRow.TemplateID, oRow.Description, that.getBundleText("msgTypeS"), that.getBundleText("messageSuccessUpl")));
                            } else {
                                var sMtResult = oMtEvent.getParameters().errorobject.responseText;
                                var oMtResult = new JSONModel();
                                oMtResult.setJSON(sMtResult);
                                fResolve(that.getReturnMsg(oRow.TemplateID, oRow.Description, that.getBundleText("msgTypeE"), oMtResult.getData().errorMessage));
                            }
                        });
                    });
                });
            },

            postAttribute: function (oExcelData) {
                var that = this;
                return new Promise(function (fResolve) {
                    var oModels = oExcelData.getData().filter(function (entry) {
                        return entry.Type === 'A';
                    });

                    //Find Unique Models
                    var uniqueModels = oModels.filter((id, index, OData) => {
                        return OData.map(mapObj => mapObj.ModelID).indexOf(id.ModelID) === index;
                    });

                    var aModelPromise = []
                    //Loop at each unique Models                    
                    for (var i = 0; i < uniqueModels.length; i++) {
                        var oModelPromise = that.postPAttribures(uniqueModels[i].ModelID, oModels);
                        aModelPromise.push(oModelPromise);
                    }
                    Promise.all(aModelPromise).then(function (aReturn) {
                        var aReturnMerge = [];
                        for (var i = 0; i < aReturn.length; i++) {
                            aReturnMerge = aReturnMerge.concat(aReturn[i]);
                        }
                        fResolve(aReturnMerge);
                    });
                })
            },

            postPAttribures(sModelId, oModels) {
                var that = this;
                return new Promise(function (fResolve) {
                    // Find Internal ID of Model
                    that.getModelInternal(sModelId).then(function (oModelReturn) {
                        if (oModelReturn.type === that.getBundleText("msgTypeE")) {
                            fResolve(that.getReturnMsg(sModelId, sModelId, that.getBundleText("msgTypeE"), oModelReturn.message));
                        }

                        if (oModelReturn.data.IntModelId !== "" && oModelReturn.data.IntModelId !== undefined) {
                            //Filter Current Model Only
                            var oCurrentModels = oModels.filter(function (entry) {
                                return entry.ModelID === sModelId;
                            });

                            // Find unique templates for each models
                            var uniqueTemplates = oCurrentModels.filter((id, index, oData) => {
                                return id.ModelID === sModelId &&
                                    oData.map(mapObj => mapObj.TemplateID).indexOf(id.TemplateID) === index;
                            });

                            that.getAttPayload(oCurrentModels, uniqueTemplates, sModelId).then(function (aPayload) {
                                var oPayload = JSON.stringify(aPayload);
                                var oAttributePost = new JSONModel();
                                oAttributePost.loadData("v1/models" + "(" + oModelReturn.data.IntModelId + ")/values", oPayload, true, "PUT", null, false, that.getHeader("apiKey"));
                                oAttributePost.attachRequestCompleted(function (oAtEvent) {
                                    var oReturn = [];
                                    if (oAtEvent.getParameters().success) {
                                        fResolve(that.getReturnMsg(sModelId, sModelId, that.getBundleText("msgTypeS"), that.getBundleText("messageSuccessUpl")));
                                    } else {
                                        var sMtResult = oAtEvent.getParameters().errorobject.responseText;
                                        var oMtResult = new JSONModel();
                                        oMtResult.setJSON(sMtResult);
                                        fResolve(that.getReturnMsg(sModelId, sModelId, that.getBundleText("msgTypeE"), oMtResult.getData().errorMessages[0].errorMessage));
                                    }
                                    fResolve(oReturn);
                                });
                            }, function (aReject) {
                                fResolve(aReject);
                            });
                        }
                    });
                });
            },

            getAttPayload(oModels, uniqueTemplates, sModelId) {
                var that = this;
                return new Promise(function (fResolve, fReject) {
                    //Find Internal ID's of all Templates of this Model
                    var oJson = {};
                    oJson.templates = [];
                    var aTPromise = [];
                    for (var i = 0; i < uniqueTemplates.length; i++) {
                        var oTPromise = that.getTemplateInternal(uniqueTemplates[i].TemplateID);
                        aTPromise.push(oTPromise);
                    }
                    Promise.all(aTPromise).then(function (aTemplateReturn) {
                        // Check for error while accessing the template
                        // If any error occured while fetching internal Id of Template return
                        var oError = aTemplateReturn.filter(function (id) {
                            return id.type === that.getBundleText("msgTypeE");
                        });
                        if (oError.length > 0) {
                            fReject(that.getReturnMsg(sModelId, sModelId, that.getBundleText("msgTypeE"), oError[0].message));
                        }
                        else {
                            //Loop at each Template ID        
                            var aTemplatePromise = [];
                            for (i = 0; i < aTemplateReturn.length; i++) {
                                var oTemplatePromise = that.getPAttTempPayload(sModelId, aTemplateReturn[i].data.TemplateID, aTemplateReturn[i].data.IntTemplateId, oModels);
                                aTemplatePromise.push(oTemplatePromise);
                            }
                            Promise.all(aTemplatePromise).then(function (aJsonTemplate) {
                                for (var i = 0; i < aJsonTemplate.length; i++) {
                                    oJson.templates.push(aJsonTemplate[i]);
                                }
                                fResolve(oJson);
                            }, function (aReject) {
                                fReject(aReject);
                            });
                        }
                    });
                });
            },

            getPAttTempPayload(sModelId, sTemplateId, sIntTemplateId, oModels) {
                var that = this;
                return new Promise(function (fResolve, fReject) {
                    //Build Payload for attribute posting            
                    var oJson = {};
                    oJson.templates = [];

                    var oJsonTemplate = {};
                    oJsonTemplate.templateId = sIntTemplateId;
                    oJsonTemplate.attributeGroups = [];


                    var oCurrentTemplate = oModels.filter(function (entry) {
                        return entry.TemplateID === sTemplateId;
                    });

                    // Find unique templates for each models
                    var uniqueUOM = oModels.filter((id, index, oData) => {
                        return oData.map(mapObj => mapObj.UOM).indexOf(id.UOM) === index;
                    });

                    var aUOMPromise = [];
                    for (var i = 0; i < uniqueUOM.length; i++) {
                        var oUOMPromise = that.getUom(uniqueUOM[i].UOM);
                        aUOMPromise.push(oUOMPromise);
                    }

                    Promise.all(aUOMPromise).then(function (aUOMReturn) {
                        // Check for error while accessing the UOM 
                        // If any error occured while fetching internal Id of UOM id return
                        var oError = aUOMReturn.filter(function (id) {
                            return id.type === that.getBundleText("msgTypeE");
                        });
                        if (oError.length > 0) {
                            fReject(that.getReturnMsg(sModelId, sModelId, that.getBundleText("msgTypeE"), oError[0].message));
                        }
                        else {
                            var oUOMReturn = aUOMReturn;
                            var oTemplateDetails = new JSONModel();
                            oTemplateDetails.loadData("v1/templates/" + sIntTemplateId, null, true, "GET",
                                null, false, that.getHeader("apiKey"));
                            oTemplateDetails.attachRequestCompleted(function (oTemplateEvent) {
                                // Check for error while accessing the Template
                                // If any error occured while fetching template details                               
                                if (oTemplateEvent.getParameters().success === false) {
                                    fReject(that.getReturnMsg(sModelId, sModelId, that.getBundleText("msgTypeE"), that.getBundleText("tmpNotAcc", sTemplateId)));
                                }

                                //Find unique attribute groups for each model and template
                                var uniqueAttributeGroups = oCurrentTemplate.filter((id, index, OData) => {
                                    return id.ModelID === sModelId &&
                                        id.TemplateID === sTemplateId &&
                                        OData.map(mapObj => mapObj.AttributeGroup).indexOf(id.AttributeGroup) === index;
                                });
                                //Get internal Id's of all the Attribute Groups
                                for (var i = 0; i < uniqueAttributeGroups.length; i++) {
                                    var sAttributeGroup = uniqueAttributeGroups[i].AttributeGroup;
                                    var aAttributeGroup = that.readAttribute(oTemplateEvent.getSource().getData(), sAttributeGroup);
                                    if (aAttributeGroup.length <= 0) {
                                        fReject(that.getReturnMsg(sModelId, sModelId, that.getBundleText("msgTypeE"), that.getBundleText("attNotFound")));
                                    }
                                    else {
                                        var oAttributeGroup = aAttributeGroup[0];
                                        oJsonTemplate.templateId = oAttributeGroup.TemplateID;
                                        var sIntattributeGroupId = oAttributeGroup.id;
                                        var oJsonAttributeGroup = {};
                                        oJsonAttributeGroup.attributeGroupId = sIntattributeGroupId;
                                        oJsonAttributeGroup.attributes = [];

                                        //Filter attribute ID for each attribute group
                                        var oAttributeIDs = oModels.filter((id) => {
                                            return id.ModelID === sModelId &&
                                                id.TemplateID === sTemplateId &&
                                                id.AttributeGroup === sAttributeGroup;
                                        });

                                        for (var j = 0; j < oAttributeIDs.length; j++) {
                                            var sAttribute = oAttributeIDs[j].AttributeId;
                                            var oAttribute = oAttributeGroup.attributes.filter((id) => {
                                                return id.internalId === sAttribute;
                                            });
                                            if (oAttribute.length <= 0) {
                                                fReject(that.getReturnMsg(sModelId, sModelId, that.getBundleText("msgTypeE"), that.getBundleText("attributeEmpty")));
                                            }
                                            else {
                                                //Build Payload for attribute posting
                                                var oJsonAttributeID = {};
                                                oJsonAttributeID.attributeId = oAttribute[0].id;
                                                oJsonAttributeID.referenceID = oAttributeGroup.TemplateID + "-" + sIntattributeGroupId;
                                                if (oAttributeIDs[j].UOM !== "" || oAttributeIDs[j].UOM === undefined) {
                                                    var oUOMInt = oUOMReturn.filter(function (id) {
                                                        return id.data.Uom === oAttributeIDs[j].UOM;
                                                    });
                                                    oJsonAttributeID.uom1 = oUOMInt[0].data.IntUom;
                                                }
                                                oJsonAttributeID.value1 = oAttributeIDs[j].Value;
                                                oJsonAttributeGroup.attributes.push(oJsonAttributeID);
                                            }
                                        }
                                        oJsonTemplate.attributeGroups.push(oJsonAttributeGroup);
                                    }
                                }
                                fResolve(oJsonTemplate);
                            });
                        }
                    });
                });
            },

            getAttributeGroup: function (sAttributeGroup) {
                var that = this;
                return new Promise(function (fResolve) {
                    var oResponse = {};
                    var oAtModel = new JSONModel();
                    if (sAttributeGroup === "" || sAttributeGroup === undefined) {
                        oResponse.type = that.getBundleText("msgTypeS");
                        oResponse.message = that.getBundleText("attributeGroupEmpty");
                        oResponse.data = {};
                        oResponse.data.AttributeGroup = sAttributeGroup;
                        oResponse.data.IntAttributeGroup = "";
                        fResolve(oResponse);
                    }
                    oAtModel.loadData("v1/attributegroups?$filter=internalId eq '" + sAttributeGroup + "'", null, true, "GET",
                        null, false, that.getHeader("apiKey"));
                    oAtModel.attachRequestCompleted(function (oAtEvent) {
                        if (oAtEvent.getParameters().success && oAtEvent.getSource().getData().length > 0) {
                            oResponse.type = that.getBundleText("msgTypeS");
                            oResponse.message = that.getBundleText("msgSuccess");
                            oResponse.data = {};
                            oResponse.data.AttributeGroup = sAttributeGroup;
                            oResponse.data.IntAttributeGroup = oAtEvent.getSource().getData()[0].id;
                            fResolve(oResponse);
                        }
                        else {
                            oResponse.type = that.getBundleText("msgTypeE");
                            oResponse.message = that.getBundleText("attNotFound", sAttributeGroup);
                            oResponse.data = {};
                            oResponse.data.AttributeGroup = sAttributeGroup;
                            oResponse.data.IntAttributeGroup = "";
                            fResolve(oResponse);
                        }
                    });
                });
            },

            getModelInternal: function (sModelId) {
                var that = this;
                return new Promise(function (fResolve) {
                    var oModel = new JSONModel();
                    oModel.loadData("v1/models?$filter=internalId eq '" + sModelId + "'", null, true, "GET",
                        null, false, that.getHeader("apiKey"));
                    oModel.attachRequestCompleted(function (oModelEvent) {
                        var oResponse = {};
                        if (oModelEvent.getParameters().success && oModelEvent.getSource().getData().length > 0) {
                            oResponse.type = that.getBundleText("msgTypeS");
                            oResponse.message = that.getBundleText("msgSuccess");
                            oResponse.data = {};
                            oResponse.data.ModelId = sModelId;
                            oResponse.data.IntModelId = oModelEvent.getSource().getData()[0].modelId;
                            fResolve(oResponse);
                        }
                        else {
                            oResponse.type = that.getBundleText("msgTypeE");
                            oResponse.message = that.getBundleText("modelNotFound", sModelId);
                            oResponse.data = {};
                            oResponse.data.ModelId = sModelId;
                            oResponse.data.IntModelId = "";
                            fResolve(oResponse);
                        }
                    });
                });
            },

            getTemplateInternal: function (sTemplateId) {
                var that = this;
                return new Promise(function (fResolve) {
                    var oTemplate = new JSONModel();
                    oTemplate.loadData("v1/templates?$filter=internalId eq '" + sTemplateId + "'", null, true, "GET",
                        null, false, that.getHeader("apiKey"));
                    oTemplate.attachRequestCompleted(function (oTemplateEvent) {
                        var oResponse = {};
                        if (oTemplateEvent.getParameters().success && oTemplateEvent.getSource().getData().length > 0) {
                            oResponse.type = that.getBundleText("msgTypeS");
                            oResponse.message = that.getBundleText("msgSuccess");
                            oResponse.data = {};
                            oResponse.data.TemplateID = sTemplateId;
                            oResponse.data.IntTemplateId = oTemplateEvent.getSource().getData()[0].id;
                            fResolve(oResponse);
                        }
                        else {
                            if (!oTemplateEvent.getParameters().success) {
                                var sTpResult = oTemplateEvent.getParameters().errorobject.responseText;
                                var oTpResult = new JSONModel();
                                oTpResult.setJSON(sTpResult);
                                var sMessage = oTpResult.getData().errorMessages[0].errorMessage;
                            } else {
                                sMessage = that.getBundleText("tmpNotFound", sTemplateId);
                            }
                            oResponse.type = that.getBundleText("msgTypeE");
                            oResponse.message = sMessage;
                            oResponse.data = {};
                            oResponse.data.TemplateID = sTemplateId;
                            oResponse.data.IntTemplateId = "";
                            fResolve(oResponse);
                        }
                    });
                });
            },

            getAttributeIDInternal: function (sAttributeID) {
                var that = this;
                return new Promise(function (fResolve) {
                    var oAttributeID = new JSONModel();
                    oAttributeID.loadData("v1/attributes?$filter=internalId eq '" + sAttributeID + "'", null, true, "GET",
                        null, false, that.getHeader("apiKey"));
                    oAttributeID.attachRequestCompleted(function (oAttributeEvent) {
                        var oResponse = {};
                        if (oAttributeEvent.getParameters().success && oAttributeEvent.getSource().getData().length > 0) {
                            oResponse.type = that.getBundleText("msgTypeS");
                            oResponse.message = that.getBundleText("msgSuccess");
                            oResponse.data = {};
                            oResponse.data.AttributeID = sAttributeID;
                            oResponse.data.IntAttributeID = oAttributeEvent.getSource().getData()[0].id;
                            fResolve(oResponse);
                        }
                        else {
                            oResponse.type = that.getBundleText("msgTypeE");
                            oResponse.message = that.getBundleText("attributeNotFound", sAttributeID);
                            oResponse.data = {};
                            oResponse.data.AttributeID = sAttributeID;
                            oResponse.data.IntAttributeID = "";
                            fResolve(oResponse);
                        }
                    });
                });
            },

            getOrganisationInternal: function (sOrgID) {
                var that = this;
                return new Promise(function (fResolve) {
                    var oOrgID = new JSONModel();
                    oOrgID.loadData("v1/organizations/byrole?roleid=1&$filter=organizationName eq '" + sOrgID + "'", null, true, "GET",
                        null, false, that.getHeader("apiKey"));
                    oOrgID.attachRequestCompleted(function (oOrgIDEvent) {
                        var oResponse = {};
                        if (oOrgIDEvent.getParameters().success && oOrgIDEvent.getSource().getData().length > 0) {
                            oResponse.type = that.getBundleText("msgTypeS");
                            oResponse.message = that.getBundleText("msgSuccess");
                            oResponse.data = {};
                            oResponse.data.OrgID = sOrgID;
                            oResponse.data.IntOrgID = oOrgIDEvent.getSource().getData()[0].id;
                            fResolve(oResponse);
                        }
                        else {
                            if (!oOrgIDEvent.getParameters().success) {
                                var sOrgResult = oOrgIDEvent.getParameters().errorobject.responseText;
                                var oOrgResult = new JSONModel();
                                oOrgResult.setJSON(sOrgResult);
                                var sMessage = oOrgResult.getData().errorMessages[0].errorMessage;
                            } else {
                                sMessage = that.getBundleText("orgNotFound", sOrgID);
                            }
                            oResponse.type = that.getBundleText("msgTypeE");
                            oResponse.message = sMessage;
                            oResponse.data = {};
                            oResponse.data.OrgID = sOrgID;
                            oResponse.data.IntOrgID = "";
                            fResolve(oResponse);
                        }
                    });
                });
            },

            getUom(sUomIso) {
                var that = this;
                return new Promise(function (fResolve) {
                    var oUomModel = new JSONModel();
                    var oResponse = {};
                    if (sUomIso === "" || sUomIso === undefined) {
                        oResponse.type = that.getBundleText("msgTypeW");
                        oResponse.message = that.getBundleText("uomEmpty");
                        oResponse.data = {};
                        oResponse.data.AttributeGroup = sUomIso;
                        oResponse.data.IntAttributeGroup = "";
                        fResolve(oResponse);
                    }
                    else {
                        oUomModel.loadData("v1/uom/dimensions?isFlat=true&$filter=unitIsoCode eq '" + sUomIso + "'", null, true, "GET",
                            null, false, that.getHeader("apiKey"));
                        oUomModel.attachRequestCompleted(function (oUomEvent) {
                            if (oUomEvent.getParameters().success && oUomEvent.getSource().getData().length > 0) {
                                oResponse.type = that.getBundleText("msgTypeS");
                                oResponse.message = that.getBundleText("msgSuccess");
                                oResponse.data = {};
                                oResponse.data.Uom = sUomIso;
                                oResponse.data.IntUom = oUomEvent.getSource().getData()[0].unitId;
                                fResolve(oResponse);
                            }
                            else {
                                oResponse.type = that.getBundleText("msgTypeE");
                                oResponse.message = that.getBundleText("uomNotFound", sUomIso);
                                oResponse.data = {};
                                oResponse.data.Uom = sUomIso;
                                oResponse.data.IntUom = "";
                                fResolve(oResponse);
                            }
                        });
                    }
                })
            },

            readAttribute(oTemplate, sAttributeGroup) {
                for (var i = 0; i < oTemplate.length; i++) {
                    if (oTemplate[i].attributeGroups.length > 0) {
                        var oAttributeGroup = oTemplate[i].attributeGroups.filter((id) => {
                            return id.internalId === sAttributeGroup
                        });
                        if (oAttributeGroup.length > 0) {
                            oAttributeGroup[0].TemplateID = oTemplate[i].id;
                            return oAttributeGroup;
                        }
                    }
                }
            }
        });
    });