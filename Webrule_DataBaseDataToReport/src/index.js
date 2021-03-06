/**
 * 从数据库加载数据到报表
 */

	var sandBox, jsonUtil, WhereRestrict, QueryCondUtil, RemoteMethodAccessor, WidgetAction, widgetContext, widgetProperty;
	var ExpressionContext, ExpressionEngine, datasourceManager, ScopeManager, DialogUtil, routeEngine, datasourceFactory, datasourcePusher, uuid;

	exports.initModule = function (sBox) {
		sandBox = sBox;
		jsonUtil = sBox.getService("vjs.framework.extension.util.JsonUtil");
		WhereRestrict = sBox.getService("vjs.framework.extension.platform.services.where.restrict.WhereRestrict");
		QueryCondUtil = sBox.getService("vjs.framework.extension.platform.services.where.restrict.QueryCondUtil");
		RemoteMethodAccessor = sBox.getService("vjs.framework.extension.platform.services.operation.remote.RemoteMethodAccessor");
		WidgetAction = sBox.getService("vjs.framework.extension.platform.services.view.widget.common.action.WidgetAction");
		widgetContext = sBox.getService("vjs.framework.extension.platform.services.view.widget.common.context.WidgetContext");
		widgetProperty = sBox.getService("vjs.framework.extension.platform.services.view.widget.common.action.WidgetProperty");
		ExpressionContext = sBox.getService("vjs.framework.extension.platform.services.engine.expression.ExpressionContext");
		ExpressionEngine = sBox.getService("vjs.framework.extension.platform.services.engine.expression.ExpressionEngine");
		datasourceManager = sBox.getService("vjs.framework.extension.platform.services.model.manager.datasource.DatasourceManager");
		ScopeManager = sBox.getService("vjs.framework.extension.platform.interface.scope.ScopeManager");
		DialogUtil = sBox.getService("vjs.framework.extension.platform.services.view.widget.common.dialog.DialogUtil");
		routeEngine = sBox.getService("vjs.framework.extension.platform.services.engine.route.RouteEngine");
		datasourceFactory = sBox.getService("vjs.framework.extension.platform.interface.model.datasource.DatasourceFactory");
		datasourcePusher = sBox.getService("vjs.framework.extension.platform.services.domain.datasource.DatasourcePusher");
		uuid = sBox.getService("vjs.framework.extension.util.UUID");
	};

	var main = function (ruleContext) {
		var scope = ScopeManager.getScope();
		var componentCode = scope.getComponentCode();
		var windowCode = scope.getWindowCode();
		var ruleCfgValue = ruleContext.getRuleCfg();

		var inParams = ruleCfgValue["inParams"];
		var inParamsObj = jsonUtil.json2obj(inParams);
		var isAsyn = inParamsObj.isAsyn; //是否异步
		var reportCode = inParamsObj.report; //报表名称
		var reportType = inParamsObj.reportType //类别
		var reportControlCode = inParamsObj.reportControl; //报表控件编码
		var itemConfigs = inParamsObj.itemsConfig; //配置信息
		var reportEvents = inParamsObj.reportEvents; //报表控件事件信息
		if (itemConfigs == null)
			return;

		if ("WindowReport" == reportType) {
			reportCode = windowCode + "." + reportCode;
		}

		var routeContext = ruleContext.getRouteContext();
		var operateType = inParamsObj.operateType; //操作类型（write,preview,expression）
		var operateTypeExpress = inParamsObj.operateTypeExpress; //操作类型表达式（解析后的值：write,preview）
		if (operateType == null) {
			operateType = "preview";
		} else if (operateType == "expression") {
			var expressionContext = new ExpressionContext();
			expressionContext.setRouteContext(routeContext);
			operateType = getExpressionValue(expressionContext, operateTypeExpress);
		}

		//获取"打印方式"完成事件
		var afterGetReportEdition = function (result) {
			var success = result["success"];
			if (success != true)
				return;

			var data = result["data"];
			var reportEdition = data.reportEdition
			var isRight = checkItemConfigs(ruleContext, reportEdition, itemConfigs);
			if (false == isRight)
				return;

			arrangeItems(itemConfigs);

			if (reportEdition != "TooneReport") {
				//加载报表文件完成事件
				var afterLoadReportFile = (function (reportCode, reportControlCode) {
					return function (resultDataString, routeContext) {
						if (resultDataString) {
							//报表配置信息
							var reportCfg = jsonUtil.json2obj(resultDataString.outputJSON);
							if (reportCfg.dataSource) {
								reportCfg.dataSource = reportCfg.dataSource.replace("|", ";");
							}
							//将报表信息加载到报表控件
							var reportData = getRemoteData(itemConfigs, ruleContext.getRouteContext());
							if (reportControlCode) {
								//执行JGReportAction.js的draw方法
								WidgetAction.executeWidgetAction(reportControlCode, "draw", reportData, reportCfg);
								//执行扩展的JS脚本
								var curWidget = widgetContext.get(reportControlCode, "widgetObj");
								//报表ID
								var curReportID = "v3Report_" + curWidget.getID();
								window['VReport'] = window[curReportID];
								//执行脚本
								exeExtendJs(itemConfigs);
							}
						} else {
							throw new Error("加载报表文件出错:" + result.msg);
						}
						ruleContext.fireRuleCallback();
					};
				})(reportCode, reportControlCode);

				//加载报表模板
				var loadReportFileParams = {
					"report": reportCode,
					"componentCode": componentCode,
				};

				RemoteMethodAccessor.invoke({
					"ruleSetCode": "CommonRule_LoadReportFile",
					"componentCode": componentCode,
					"commitParams": [{
						paramName: "inParams",
						paramType: "char",
						paramValue: jsonUtil.obj2json(loadReportFileParams)
					}],
					"isAsyn": isAsyn,
					"afterResponse": afterLoadReportFile
				});
			} else {
				//打印方式为"TooneReport"
				registEventForTooneReport(componentCode, windowCode, reportControlCode, reportEvents, routeContext);
				getRequestForTooneReport(itemConfigs, routeContext);
				getRemoteDataForTooneReport(routeContext, reportType, reportCode, reportControlCode, itemConfigs, operateType);
			}
		}

		var printTypeParams = {
			"isAsyn": false,
			"componentCode": scope.getComponentCode(),
			"windowCode": scope.getWindowCode(),
			ruleSetCode: "GetReportEdition",
			isRuleSetCode: false,
			afterResponse: afterGetReportEdition
		}

		//获取"打印方式"
		RemoteMethodAccessor.invoke(printTypeParams);

		routeContext.setCallBackFlag(false);
	};

	// 是否存在外部方法。返回值true：存在， false：不存在
	var isExistApi = function (itemConfigs) {
		for (var i = 0; i < itemConfigs.length; i++) {
			var itemConfig = itemConfigs[i];
			var sourceType = itemConfig.Istype;
			if (sourceType == "Api") {
				return true;
			}
		}
		return false;
	}

	// 是否存在窗体实体。返回值true：存在， false：不存在
	var isExistWindowEntity = function (itemConfigs) {
		for (var i = 0; i < itemConfigs.length; i++) {
			var itemConfig = itemConfigs[i];
			var sourceType = itemConfig.Istype;
			if (sourceType == "WindowEntity") {
				return true;
			}
		}
		return false;
	}

	// 是否存在执行脚本。返回值true：存在， false：不存在
	var isExistExeScript = function (itemConfigs) {
		for (var i = 0; i < itemConfigs.length; i++) {
			var itemConfig = itemConfigs[i];
			var exeScript = itemConfig.exeScript;
			if (exeScript != null && exeScript != "") {
				return true;
			}
		}
		return false;
	}

	// 所有配置中的字段映射中是否存在表达式。返回值true：存在， false：不存在
	var isExistExpression = function (itemConfigs) {
		for (var i = 0; i < itemConfigs.length; i++) {
			var items = itemConfigs[i].items;
			for (var j = 0; j < items.length; j++) {
				var item = items[j];
				var type = item.type;
				if (type == "expression") {
					return true;
				}
			}
		}
		return false;
	}

	// 字段映射中是否存在表达式。返回值true：存在， false：不存在
	var isExistExpressionInItems = function (items) {
		for (var j = 0; j < items.length; j++) {
			var item = items[j];
			var type = item.type;
			if (type == "expression") {
				return true;
			}
		}
		return false;
	}

	// 校验配置信息是否正确
	var checkItemConfigs = function (ruleContext, reportEdition, itemConfigs) {
		if (reportEdition != "TooneReport") {
			var isExist = isExistApi(itemConfigs);
			if (isExist) {
				showMessage(ruleContext, "此打印方式不支持调用 [外部方法]。");
				return false;
			}
		} else {
			var isExist = false;
			isExist = isExistExeScript(itemConfigs);
			if (isExist) {
				showMessage(ruleContext, "此打印方式不支持调用 [执行脚本]。");
				return false;
			}
		}

		return true;
	}

	// 弹出提示窗口
	var showMessage = function (ruleContext, msg) {
		DialogUtil.warnDialog(msg, null, false);
		ruleContext.fireRouteCallback();
		ScopeManager.closeScope();
	}

	// 移除构件编码
	var getFieldName = function (name, fieldType) {
		var result = name;
		if (fieldType === "entityField") {
			var nameArr = name.split(".");
			if (nameArr.length > 2) {
				result = nameArr[nameArr.length - 2] + "." + nameArr[nameArr.length - 1];
			}
		}
		return result;
	}

	// 重新整理映射信息，去掉构件编码
	var arrangeItems = function (itemConfigs) {
		for (var i = 0; i < itemConfigs.length; i++) {
			var items = itemConfigs[i].items;
			for (var j = 0; j < items.length; j++) {
				var item = items[j];
				var destName = item.destName;
				var sourceName = item.sourceName;
				destName = getFieldName(destName, item.type);
				sourceName = getFieldName(sourceName, item.type);
				item.destName = destName;
				item.sourceName = sourceName;
			}
		}
	}

	// 执行扩展脚本
	var exeExtendJs = function (itemConfigs) {
		if (!itemConfigs)
			return;

		for (var i = 0, len = itemConfigs.length; i < len; i++) {
			var itemConfig = itemConfigs[i];
			var exeScript = itemConfig && itemConfig["exeScript"];
			if (exeScript && exeScript !== "") {
				try {
					eval(exeScript);
				} catch (e) {
					window.console && console.log("执行自定义脚本报错，请检查脚本：" + e);
				}
			}
		}
	}

	// 获取数据源
	var getRemoteData = function (itemConfigs, routeContext) {
		var reportDatas = {};
		for (var i = 0; i < itemConfigs.length; i++) {
			var itemConfig = itemConfigs[i];
			//来源类型（Table：表，Query：查询， WindowEntity：窗体实体，Api：方法）
			var isType = itemConfig["Istype"];
			//来源数据
			var sourceName = itemConfig["sourceName"];
			//目标数据
			var entityName = itemConfig["entityName"];
			//过滤条件
			var queryConds = itemConfig["dsWhere"];
			//源数据中的字段
			var itemqueryparam = itemConfig["itemqueryparam"];
			//映射关系
			var items = itemConfig["items"];
			// 自定义查询时，扩展的查询条件
			var extraCondition = null;
			// 根据过滤条件获取出源数据源数据
			var isCustomSqlFind = (isType + "") == "1";
			var wrParam = {
				"fetchMode": 'custom',
				"routeContext": routeContext
			};
			var whereRestrict = WhereRestrict.init(wrParam);
			if (undefined != queryConds && null != queryConds && queryConds.length > 0) {
				whereRestrict.andExtraCondition(queryConds, isCustomSqlFind ? "custom" : "table");
			}
			var params = QueryCondUtil.genCustomParams({
				"paramDefines": itemqueryparam,
				"routeContext": routeContext
			});
			whereRestrict.addExtraParameters(params);

			var queryParams = {};
			var queryType = "Table";
			if (isType == "WindowEntity") {
				var db = datasourceManager.lookup({
					"datasourceName": sourceName
				});
				if (db) {
					var datas = callBack(db.serialize(), items, routeContext);
					reportDatas[entityName] = datas;
				} else {
					throw Error("[DataBaseDataToReport.main]未找到窗体界面实体，请检查配置！实体编号：" + sourceName);
				}
			} else {
				if (isType == 1) { //自定义查询
					queryType = "Query";
					queryParams = genCustomSqlQueryParams(whereRestrict.toParameters());
				} else {
					queryParams = whereRestrict.toParameters();
					// 排序条件处理
					var orderByCfg = itemConfig["orderBy"];
					if (orderByCfg && typeof orderByCfg != 'undefined' && orderByCfg.length > 0) {
						for (var obIndex = 0; obIndex < orderByCfg.length; obIndex++) {
							var orderByItem = orderByCfg[obIndex];
							if (!orderByItem.field || orderByItem.field == "") {
								continue;
							}
							var fieldArray = orderByItem.field.split(".");
							var orderByField = fieldArray[fieldArray.length - 1];
							if (orderByItem.type.toLowerCase() == 'desc') {
								whereRestrict.addOrderByDesc(orderByField);
							} else {
								whereRestrict.addOrderBy(orderByField);
							}
						}
					}
				}

				var dataQuery = sandBox.getService("vjs.framework.extension.platform.services.repository.query");
				var param = [{
					"dataSourceName": sourceName,
					"whereRestrict": whereRestrict,
					"queryRecordStart": -1,
					"queryPageSize": -1,
					"queryType": queryType
				}];
				var isAsyn = false;

				// 2015-06-26 liangchaohui：根据SDK调整作出修改
				// dataQuery.query(param,isAsyn,callBack);
				dataQuery.query({
					"queryParams": param,
					"isAsync": isAsyn,
					"success": function (result) {
						if (result) {
							var datas = callBack(result[0], items, routeContext);
							reportDatas[entityName] = datas;
						}
					}
				});
			}
		}
		return {
			"values": reportDatas
		};
	}

	var callBack = function (result, items, routeContext) {
		//封装成报表数据结构  {"values":{"dsName":[{"destfield1":value1},{"destfield2":value2}]}}
		var datas = [];
		if (result) {
			var resultData = result.datas.values;
			if (items && items.length > 0) {
				var context = new ExpressionContext();
				context.setRouteContext(routeContext);
				for (var j = 0; j < resultData.length; j++) {
					var dataObj = resultData[j];
					var temp = {};
					for (var field in dataObj) {
						for (var i = 0; i < items.length; i++) {
							var destName = items[i].destName;
							var sourceName = items[i].sourceName;
							var sourcetype = items[i].type;
							var destField = destName.split(".")[1];
							// 2015-07-15 兼容处理[构件名].[表名]的情况，只取[表名]
							if (destField.indexOf(".") != -1) {
								var destFieldItems = destField.split(".");
								destField = destFieldItems[destFieldItems.length - 1];
							}
							if (sourcetype != "expression") {
								var sourceField = sourceName.split(".")[1];
								if (sourceField.indexOf(".") != -1) {
									var sourceFieldItems = sourceField.split(".");
									sourceField = sourceFieldItems[sourceFieldItems.length - 1];
								}
								if (field == sourceField) {
									temp[destField] = dataObj[field];
								}
							} else {
								var otherValue = getExpressionValue(context, sourceName);
								temp[destField] = otherValue;
							}
						}
					}
					datas.push(temp);
				}
			}
		}
		return datas;
	}

	//获取自定义查询参数
	var genCustomSqlQueryParams = function (params) {
		// 构建实际查询时需要的参数对象
		var queryParams = {};
		if (params) {
			for (var key in params) {
				queryParams[key] = {};
				queryParams[key]["paramName"] = key;
				queryParams[key]["paramValue"] = params[key];
			}
		}
		return queryParams;
	};

	var getFromWindowEntity = function (itemConfig, routeContext) {
		//来源数据
		var sourceName = itemConfig["sourceName"];
		//报表实体
		var entityName = itemConfig["entityName"];
		//映射关系
		var items = itemConfig["items"];

		var db = datasourceManager.lookup({
			"datasourceName": sourceName
		});

		if (db) {
			var dbSerialize = db.serialize();
			var datas = callBack(dbSerialize, items, routeContext);
			dbSerialize.datas = datas;
			return dbSerialize;
		} else {
			throw Error("[DataBaseDataToReport.main]未找到窗体界面实体，请检查配置！实体编号：" + sourceName);
		}
	}

	var getFromDataBase = function (itemConfig, routeContext) {
		//来源类型
		var isType = itemConfig["Istype"];
		//来源数据
		var sourceName = itemConfig["sourceName"];
		//映射关系
		var items = itemConfig["items"];
		//过滤条件
		var queryConds = itemConfig["dsWhere"];
		//查询参数
		var itemqueryparam = itemConfig["itemqueryparam"];

		var wrParam = {
			"fetchMode": 'custom',
			"routeContext": routeContext
		};
		var whereRestrict = WhereRestrict.init(wrParam);

		//根据过滤条件获取出源数据
		var isCustomSqlFind = (isType + "") == "1";
		if (undefined != queryConds && null != queryConds && queryConds.length > 0) {
			whereRestrict.andExtraCondition(queryConds, isCustomSqlFind ? "custom" : "table");
		}

		var params = QueryCondUtil.genCustomParams({
			"paramDefines": itemqueryparam,
			"routeContext": routeContext
		});
		whereRestrict.addExtraParameters(params);

		var queryParams = {};
		var queryType = "Table";
		if (isType == 1) { //自定义查询
			queryType = "Query";
			var params = whereRestrict.toParameters();
			if (params) {
				for (var key in params) {
					queryParams[key] = {};
					queryParams[key]["paramName"] = key;
					queryParams[key]["paramValue"] = params[key];
				}
			}
		} else {
			queryParams = whereRestrict.toParameters();
			// 排序条件处理
			var orderByCfg = itemConfig["orderBy"];
			if (orderByCfg && typeof orderByCfg != 'undefined' && orderByCfg.length > 0) {
				for (var obIndex = 0; obIndex < orderByCfg.length; obIndex++) {
					var orderByItem = orderByCfg[obIndex];
					if (!orderByItem.field || orderByItem.field == "") {
						continue;
					}
					var fieldArray = orderByItem.field.split(".");
					var orderByField = fieldArray[fieldArray.length - 1];
					if (orderByItem.type.toLowerCase() == 'desc') {
						whereRestrict.addOrderByDesc(orderByField);
					} else {
						whereRestrict.addOrderBy(orderByField);
					}
				}
			}
		}

		var dataQuery = sandBox.getService("vjs.framework.extension.platform.services.repository.query");
		var param = [{
			"dataSourceName": sourceName,
			"whereRestrict": whereRestrict,
			"queryRecordStart": -1,
			"queryPageSize": -1,
			"queryType": queryType
		}];

		var isAsyn = false;
		var resultObj;
		dataQuery.query({
			"queryParams": param,
			"isAsync": isAsyn,
			"success": function (result) {
				if (result) {
					resultObj = result[0];
					datas = callBack(resultObj, items, routeContext);
					resultObj.datas = datas;
				}
			}
		});

		return resultObj;
	}

	//获取表达式值
	var getExpressionValue = function (expressionContext, srcExpression) {
		var value = ExpressionEngine.execute({
			"expression": srcExpression,
			"context": expressionContext
		});

		return value;
	}

	//处理"表"、"查询"表达式
	var getWhereRestrictExpression = function (routeContext, dsWhere, itemqueryparam, orderBys) {
		var mode = "table";
		var wrParam = {
			"fetchMode": mode,
			"routeContext": routeContext
		};
		var whereRestrict = WhereRestrict.init(wrParam);

		//过滤条件
		if (undefined != dsWhere && null != dsWhere && dsWhere.length > 0) {
			whereRestrict.andExtraCondition(dsWhere, mode);
		}

		//查询参数
		var params = queryConditionUtil.genCustomParams({
			"paramDefines": itemqueryparam,
			"routeContext": routeContext
		});
		whereRestrict.addExtraParameters(params);

		//排序
		if (undefined != orderBys && null != orderBys && orderBys.length > 0) {
			for (var j = 0; j < orderBys.length; j++) {
				var orderByItem = orderBys[j];
				if (!orderByItem.field || orderByItem.field == "") {
					continue;
				}
				var fieldArray = orderByItem.field.split(".");
				var orderByField = fieldArray[fieldArray.length - 1];
				if (orderByItem.type.toLowerCase() == 'desc') {
					whereRestrict.addOrderByDesc(orderByField);
				} else {
					whereRestrict.addOrderBy(orderByField);
				}
			}
		}

		return whereRestrict;
	}

	//处理"外部方法"表达式
	var getApiExpression = function (routeContext, invokeRuleParams) {
		if (invokeRuleParams != null) {
			var expressionContext = new ExpressionContext();
			expressionContext.setRouteContext(routeContext);
			for (var j = 0; j < invokeRuleParams.length; j++) {
				var item = invokeRuleParams[j];
				var paramType = item.paramType;
				if (paramType == "expression") {
					var srcExpression = item.paramSourceValue;
					var destExpression = getExpressionValue(expressionContext, srcExpression);
					item.paramSourceValue = destExpression;
				}
			}
		}
	}

	//打印方式为"TooneReport"，注册报表控件事件
	var registEventForTooneReport = function (componentCode, windowCode, reportControlCode, reportEvents, routeContext) {
		var scopeId = ScopeManager.getCurrentScopeId();
		if (reportEvents != null && reportEvents.length > 0) {
			for (var i = 0; reportEvents != null && i < reportEvents.length; i++) {
				var reportEvent = reportEvents[i];
				var eventCode = reportEvent.eventCode;
				var ruleSetCode = reportEvent.ruleSetCode;
				var invokeParams = reportEvent.invokeParams;
				var returnMappings = reportEvent.returnMapping;
				//原逻辑（规则注册事件）
				registEventItemForTooneReport(componentCode, windowCode, reportControlCode, routeContext, eventCode, ruleSetCode, invokeParams, returnMappings, scopeId);
			}
		}

		//单元格注册事件
		registControlEventItemForTooneReport(reportControlCode, scopeId);
	}

	var registControlEventItemForTooneReport = function (reportControlCode, scopeId) {
		WidgetAction.executeWidgetAction(reportControlCode, "registReportEvent", "CellClick", function (rptData, successCallback, failCallback) {
			if (rptData && rptData.eventCode) {
				var ruleSetCode = rptData.eventCode;
				ScopeManager.openScope(scopeId);
				routeEngine.executeWindowRoute({
					"ruleSetCode": ruleSetCode,
					"args": null,
					"success": function (args) {
						successCallback(args);
					},
					"fail": function (args) {
						alert("fail");
						failCallback(args);
					}
				});
				ScopeManager.closeScope();
			}
		});
	}

	var registEventItemForTooneReport = function (componentCode, windowCode, reportControlCode, routeContext, eventCode, ruleSetCode, invokeParams, returnMappings, scopeId) {
		WidgetAction.executeWidgetAction(reportControlCode, "registReportEvent", eventCode, function (rptData, successCallback, failCallback) {
			ScopeManager.openScope(scopeId);
			var param = parseParam(invokeParams, componentCode, windowCode, ruleSetCode, "local", "client-ruleSet", routeContext, rptData);
			routeEngine.executeWindowRoute({
				"ruleSetCode": ruleSetCode,
				"args": param,
				"success": function (args) {
					if (!successCallback) {
						return;
					}

					var returnArgs = {};
					if (returnMappings) {
						for (var j = 0; j < returnMappings.length; j++) {
							var mapping = returnMappings[j];
							var srcValue = mapping["srcValue"];
							var destValue = mapping["destValue"];
							if (!srcValue || !destValue) {
								continue;
							}
							var fieldMappings = mapping["fieldMapping"];

							var srcDatasource = args[srcValue];
							if (!srcDatasource) {
								continue;
							}
							var srcObjs = srcDatasource.getAllRecords().datas;
							if (srcObjs && srcObjs.length > 0) {
								var srcObj = srcObjs[0];
								var destObj = {};
								for (var k = 0; k < fieldMappings.length; k++) {
									var fieldMapping = fieldMappings[k];
									var srcType = fieldMapping["srcType"];
									var srcFieldName = fieldMapping["srcValue"];
									var destFieldName = fieldMapping["destValue"];
									if (!destFieldName) {
										continue;
									}
									var items = destFieldName.split(".");
									if (items.length > 1) {
										destFieldName = items[1];
									}

									var value = null;
									if (srcType && srcType == "expression") {
										var expressionContext = new ExpressionContext();
										expressionContext.setRouteContext(routeContext);
										value = getExpressionValue(expressionContext, srcFieldName);
									} else {
										var value = srcObj[srcFieldName];
									}
									destObj[destFieldName] = value;
								}

								//修改状态
								var statValue = destObj[STATE_FIELDNAME];
								if (statValue != ADD_STATE) {
									destObj[STATE_FIELDNAME] = EDIT_STATE;
								}

								returnArgs[destValue] = destObj;
							}
						}
					}

					successCallback(returnArgs);
				},
				"fail": function (args) {
					if (!failCallback) {
						failCallback(args);
					}
				}
			});
			ScopeManager.closeScope();
		});
	}

	var parseParam = function (invokeParams, componentCode, windowCode, ruleSetCode, invokeType, sourceType, routeContext, rptData) {
		var param = {};
		//获取活动集配置
		var ruleSetConfig;
		if (windowCode) {
			var windowRoute = sandBox.getService("vjs.framework.extension.platform.data.storage.schema.route.WindowRoute");
			ruleSetConfig = windowRoute.getRoute({
				"componentCode": componentCode,
				"windowCode": windowCode,
				"routeCode": ruleSetCode
			});
		} else {
			var componentRoute = sandBox.getService("vjs.framework.extension.platform.data.storage.schema.route.ComponentRoute");
			ruleSetConfig = componentRoute.getRoute({
				"componentCode": componentCode,
				"routeCode": ruleSetCode
			});
		}
		for (var i = 0; invokeParams != null && i < invokeParams.length; i++) {
			var invokeObj = invokeParams[i];
			var paramCode = invokeObj["paramCode"];
			if (paramCode == null || paramCode == "") {
				throw new Error("输入参数名不能为空");
			}

			//参数类型，expression:表达式，entity:实体
			var paramType = invokeObj["paramType"];
			//来源类型：1、窗体实体。2、窗体输入实体。3、方法输入实体。4、方法变量实体。5、报表实体
			var paramSource = invokeObj["paramSource"];
			if (paramType == "expression") {
				parseParamForExpression(routeContext, invokeObj, param, rptData);
			} else if (paramType == "entity") {
				if (paramSource == "ReportEntity") {
					parseParamForReportEntity(routeContext, invokeObj, param, ruleSetConfig, rptData);
				} else {
					parseParamForEntity(routeContext, invokeObj, param, ruleSetConfig);
				}
			}
		}

		if (sourceType == "server-ruleSet") {
			return param;
		}
		//如果调用活动集时，设置了入参，则将此入参的值覆盖到活动集原始配置参数中。
		var mockParam = {};
		if (ruleSetConfig && ruleSetConfig.getInputs()) {
			var ruleSetcfg_inputs = ruleSetConfig.getInputs();
			for (var i = 0, l = ruleSetcfg_inputs.length; i < l; i++) {
				var input_Obj = ruleSetcfg_inputs[i];
				var input_value = input_Obj.geInitValue();
				var type = input_Obj.getType();
				//如果参数为实体类型，则转为游离DB
				if (type == "entity") {
					var fieldsMapping = input_Obj.getConfigs();;
					var freeDB = getFreeDB(fieldsMapping);
					input_value = freeDB;
				}
				mockParam[input_code] = input_value;
				for (var param_code in param) {
					if (input_code = param_code) {
						mockParam[input_code] = param[param_code];
					}
				}
			}
		}
		//执行SPI活动集时，当发现有configData信息时，需要以configData的入参来替换掉原装SPI入参
		if (invokeType == "spi") {
			var configData_inputs = appData.getRuleSetInputs({
				"componentCode": componentCode,
				"windowCode": windowCode,
				"metaCode": ruleSetCode
			});
			if (configData_inputs && configData_inputs.length > 0) {
				//用configData过滤:只过滤非实体类型。(目前只考虑简单类型的匹配，即非实体类型)
				if (configData_inputs && configData_inputs.length > 0) {
					for (var input_code in mockParam) {
						for (var j = 0; j < configData_inputs.length; j++) {
							var configDataObj = configData_inputs[j];
							var configDataObj_code = configDataObj.getCode();
							var configDataObj_initValue = configDataObj.geInitValue();
							if (input_code == configDataObj_code) {
								mockParam[input_code] = configDataObj_initValue;
							}
						}
					}
				}
			}
		}
		return mockParam;
	}

	var parseParamForExpression = function (routeContext, invokeObj, param, rptData) {
		//活动集参数
		if (!rptData || !rptData.data)
			return;

		var paramCode = invokeObj["paramCode"];
		var value = invokeObj["paramValue"];
		if (value != null && value != "") {
			var context = new ExpressionContext();
			context.setRouteContext(routeContext);

			var selectedEntity = {};
			var entityNames = Object.keys(rptData.data);
			for (var i = 0; i < entityNames.size(); i++) {
				var entityName = entityNames[i];
				var entity = rptData.data[entityName];
				var fieldCodes = Object.keys(entity);
				for (var j = 0; j < fieldCodes.size(); j++) {
					var fieldCode = fieldCodes[j];
					var key = entityName + "." + fieldCode;
					selectedEntity[key] = entity[fieldCode];
				}
			}

			context.getExpressionContext().put("Report@@Entity", selectedEntity);
			var val = ExpressionEngine.execute({
				"expression": value,
				"context": context
			});
			param[paramCode] = val;
		}
	}

	var parseParamForEntity = function (routeContext, invokeObj, param, ruleSetConfig) {
		//活动集参数
		var paramCode = invokeObj["paramCode"];
		//值来源
		var srcEntityName = invokeObj["paramValue"];
		//来源类型：窗体实体、窗体输入实体、方法输入实体、方法变量实体、报表实体
		var paramSource = invokeObj["paramSource"];
		//数据提交方式：modify:修改过的(新增,修改或删除的)，all:(默认,新增,修改或删除的)
		var dataFilterType = invokeObj["dataFilterType"];
		//字段映射
		var paramFieldMapping = invokeObj["paramFieldMapping"];

		checkParamFieldMapping(paramFieldMapping, ruleSetConfig);

		//创建游离DB
		var fieldsMapping = ruleSetConfig.getInput(paramCode).getConfigs();
		var freeDB = getFreeDB(fieldsMapping);
		var srcDB = null;
		switch (paramSource) {
			case "ruleSetInput":
				srcDB = routeContext.getInputParam(srcEntityName);
				break;
			case "ruleSetVar":
				srcDB = routeContext.getVariable(srcEntityName);
				break;
			case "windowInput":
				srcDB = windowParam.getInput({
					"code": srcEntityName
				});
				break;
			default:
				srcDB = datasourceManager.lookup({
					"datasourceName": srcEntityName
				});
				break;
		}

		if (srcDB) {
			datasourcePusher.copyBetweenEntities({
				"sourceEntity": srcDB,
				"destEntity": freeDB,
				"valuesMapping": paramFieldMapping,
				"dataFilterType": dataFilterType,
				"routeContext": routeContext
			});
		}

		param[paramCode] = freeDB;
	}

	var STATE_FIELDNAME = "I_N_P_U_T_S_T_A_T_E";
	var UNCHANGE_STATE = "UnChange";
	var ADDEMPTY_STATE = "AddEmpty";
	var ADD_STATE = "Add";
	var EDIT_STATE = "Edit";
	var DELETE_STATE = "Delete";

	var parseParamForReportEntity = function (routeContext, invokeObj, param, ruleSetConfig, rptData) {
		if (!rptData || !rptData.data)
			return;

		//活动集参数
		var destEntityName = invokeObj["paramCode"];
		//值来源
		var srcEntityName = invokeObj["paramValue"];
		//活动集参数 值来源 之间的字段映射
		var paramFieldMapping = invokeObj["paramFieldMapping"];
		//校验字段映射
		checkParamFieldMapping(paramFieldMapping, ruleSetConfig);
		//活动集参数中的实体字段列表
		var destFields = ruleSetConfig.getInput(destEntityName).getConfigs();
		//受限于界面实体更新算法，增加stateFieldName字段，生成更新记录时，修改此字段的值。
		destFields = addStateField(destFields);
		paramFieldMapping = addStateFieldMapping(paramFieldMapping);
		changeParamFieldMapping(paramFieldMapping);

		var srcDatas = rptData.data[srcEntityName];
		var destDataSource = createDataSource(routeContext, srcDatas, destFields, paramFieldMapping)
		param[destEntityName] = destDataSource;
	}

	var checkParamFieldMapping = function (paramFieldMapping, ruleSetConfig) {
		if (paramFieldMapping == null || paramFieldMapping.length == 0) {
			throw new Error("输入参数类型为实体时，参数实体字段映射不能为空");
		}

		for (var i = 0; paramFieldMapping != null && i < paramFieldMapping.length; i++) {
			var mappingItem = paramFieldMapping[i];
			var paramEntityField = mappingItem["paramEntityField"];
			if (paramEntityField == null || paramEntityField == "") {
				throw new Error("输入参数类型为实体时，参数实体字段不能为空");
			}
			//字段值(字段值类型为field时为前台实体的字段,否则为表达式)
			var fieldValue = mappingItem["fieldValue"];
			//字段来源类型：field:前台实体字段, expression:表达式
			var fieldValueType = mappingItem["fieldValueType"];
			if (fieldValueType == "entityField" && (fieldValue == null || fieldValue == "")) {
				throw new Error("输入参数类型为实体时，来源字段配置不能为空");
			}
		}
		if (!ruleSetConfig) {
			var exception = exceptionFactory.create({
				"message": "请先打开目标组件容器！componentCode=" + componentCode + "windowCode=" + windowCode,
				"type": exceptionFactory.TYPES.Business
			});
			throw exception;
		}
	}

	var addStateField = function (destFields) {
		var newDestFields = [];
		$.extend(newDestFields, destFields);

		var extendField = {};
		$.extend(extendField, newDestFields[0]);
		extendField.code = STATE_FIELDNAME;
		extendField.configs = null;
		extendField.initValue = null;
		extendField.type = "char";
		newDestFields.push(extendField);

		return newDestFields;
	}

	var addStateFieldMapping = function (paramFieldMapping) {
		var newParamFieldMapping = [];
		$.extend(newParamFieldMapping, paramFieldMapping);

		var extendMappingItem = {};
		extendMappingItem["paramEntityField"] = STATE_FIELDNAME;
		extendMappingItem["fieldValue"] = STATE_FIELDNAME;
		newParamFieldMapping.push(extendMappingItem);

		return newParamFieldMapping;
	}

	var changeParamFieldMapping = function (paramFieldMapping) {
		for (var i = 0; i < paramFieldMapping.length; i++) {
			var mappingItem = paramFieldMapping[i];
			var fieldValue = mappingItem["fieldValue"];
			var fieldValueType = mappingItem["fieldValueType"];
			if ("expression" != fieldValueType) {
				//为实体时，去掉实体名称
				var items = fieldValue.split(".");
				if (items.length > 1) {
					fieldValue = items[items.length - 1];
				}
				mappingItem["fieldValue"] = fieldValue;
			}
		}
	}

	var createDataSource = function (routeContext, srcDatas, destFields, paramFieldMapping) {
		var freeDB = getFreeDB(destFields);
		var loadDatas = [];
		var addDatas = [];
		var editDatas = [];
		var tmpEditDatas = [];
		var delDatas = [];

		if (srcDatas instanceof Array) {
			for (var i = 0; i < srcDatas.length; i++) {
				var srcData = srcDatas[i];
				var stateFieldValue = srcData[STATE_FIELDNAME];
				if (stateFieldValue == UNCHANGE_STATE) {
					//未修改
					var loadData = createLoadData(routeContext, srcData, paramFieldMapping, stateFieldValue);
					loadDatas.push(loadData);
				} else if (stateFieldValue == ADD_STATE) {
					//增加
					var destRecord = createRecord(routeContext, freeDB, srcData, paramFieldMapping, stateFieldValue);
					var item = {};
					item.index = i;
					item.records = destRecord;
					addDatas.push(item);
				} else if (stateFieldValue == EDIT_STATE) {
					//修改
					var loadData = createLoadData(routeContext, srcData, paramFieldMapping, stateFieldValue);
					loadDatas.push(loadData);

					var editRecord = createRecord(routeContext, freeDB, srcData, paramFieldMapping, stateFieldValue);
					editDatas.push(editRecord);
					var tmEditRecord = createRecord(routeContext, freeDB, srcData, paramFieldMapping, UNCHANGE_STATE);
					tmpEditDatas.push(tmEditRecord);
				} else if (stateFieldValue == DELETE_STATE) {
					//删除
					//必须有id字段
					var id = srcData["id"];
					if (id) {
						delDatas.push(id);
					}
					var loadData = createLoadData(routeContext, srcData, paramFieldMapping, stateFieldValue);
					loadDatas.push(loadData);
				}
			}
		}

		//加载
		var obj = {};
		obj.datas = loadDatas;
		obj.dataAmount = loadDatas.length;
		obj.isAppend = true;
		freeDB.load(obj);

		//增加
		if (addDatas && addDatas.length > 0) {
			for (var i = 0; i < addDatas.length; i++) {
				var item = addDatas[i];
				var index = item.index;
				var selectedRecord = freeDB.getRecordByIndex(index);
				if (selectedRecord) {
					var selectedObj = {};
					selectedObj.records = [selectedRecord];
					selectedObj.isSelect = true;
					freeDB.selectRecords(selectedObj)
				}
				var addObj = {};
				addObj.records = [item.records];
				addObj.position = "BEFORE";
				freeDB.insertRecords(addObj);
			}
		}

		//修改
		if (editDatas && editDatas.length > 0) {
			var editObj = {};
			editObj.records = tmpEditDatas;
			freeDB.updateRecords(editObj);

			editObj.records = editDatas;
			freeDB.updateRecords(editObj);
		}

		//删除
		if (delDatas && delDatas.length > 0) {
			var deleteObj = {};
			deleteObj.ids = delDatas;
			freeDB.removeRecordByIds(deleteObj);
		}

		return freeDB;
	}

	var createLoadData = function (routeContext, srcData, paramFieldMapping, stateFieldValue) {
		var result = {};
		for (var i = 0; i < paramFieldMapping.length; i++) {
			var mappingItem = paramFieldMapping[i];
			var paramEntityField = mappingItem["paramEntityField"];
			var fieldValue = mappingItem["fieldValue"];
			var fieldValueType = mappingItem["fieldValueType"];

			var value;
			if ("expression" == fieldValueType) {
				var expressionContext = new ExpressionContext();
				expressionContext.setRouteContext(routeContext);
				value = getExpressionValue(expressionContext, fieldValue);
			} else {
				value = srcData[fieldValue];
			}

			result[paramEntityField] = value;
		}
		result[STATE_FIELDNAME] = stateFieldValue;
		return result;
	}

	var createRecord = function (routeContext, freeDB, srcData, paramFieldMapping, stateFieldValue) {
		var destRecord = freeDB.createRecord();
		for (var i = 0; i < paramFieldMapping.length; i++) {
			var mappingItem = paramFieldMapping[i];
			var paramEntityField = mappingItem["paramEntityField"];
			var fieldValue = mappingItem["fieldValue"];
			var fieldValueType = mappingItem["fieldValueType"];

			var value;
			if ("expression" == fieldValueType) {
				var expressionContext = new ExpressionContext();
				expressionContext.setRouteContext(routeContext);
				value = getExpressionValue(expressionContext, fieldValue);
			} else {
				value = srcData[fieldValue];
			}

			destRecord.set(paramEntityField, value);
		}
		destRecord.set(STATE_FIELDNAME, stateFieldValue);
		return destRecord;
	}

	var getFreeDB = function (fieldsMapping) {
		var json = createJsonFromConfig(fieldsMapping);
		return datasourceFactory.unSerialize(json);
	}

	var createJsonFromConfig = function (params) {
		var fields = [];
		var freeDBName = "freeDB_" + uuid.generate();
		for (var i = 0, l = params.length; i < l; i++) {
			var param = params[i];
			fields.push({
				"code": param.getCode(),
				"name": param.getName(),
				"type": param.getType(),
				"defaultValue": param.geInitValue()
			});
		}
		return {
			"datas": {
				"values": []
			},
			"metadata": {
				"model": [{
					"datasource": freeDBName,
					"fields": fields
				}]
			}
		};
	}

	//打印方式为"TooneReport"，整理itemConfigs
	var getRequestForTooneReport = function (itemConfigs, routeContext) {
		for (var i = 0; i < itemConfigs.length; i++) {
			var itemConfig = itemConfigs[i];
			//来源类型（Table：表，Query：查询， WindowEntity：窗体实体，Api：方法）
			var sourceType = itemConfig.Istype;
			if (sourceType == "Table" || sourceType == "Query") {
				//字段映射
				var items = itemConfig.items;
				var isExist = isExistExpressionInItems(items);
				if (isExist) {
					var datas = getFromDataBase(itemConfig, routeContext)
					itemConfig.datas = datas;
				} else {
					//过滤条件
					var dsWhere = itemConfig.dsWhere;
					//查询参数
					var itemqueryparam = itemConfig.itemqueryparam;
					//排序
					var orderBys = itemConfig.orderBy;

					var whereRestrict = getWhereRestrictExpression(routeContext, dsWhere, itemqueryparam, orderBys);
					itemConfig.queryParameters = whereRestrict.toParameters();
					itemConfig.queryCondition = whereRestrict.toWhere();
					itemConfig.queryOrderBy = whereRestrict.toOrderBy();
				}
			} else if (sourceType == "WindowEntity") {
				var datas = getFromWindowEntity(itemConfig, routeContext)
				itemConfig.datas = datas;
			} else if (sourceType == "Api") {
				var invokeRuleParams = itemConfig.invokeRuleParams;
				getApiExpression(routeContext, invokeRuleParams);
			}
		}
	}

	//打印方式为"TooneReport"，获取Html数据
	var getHtmlData = function (reportType, reportCode, reportControlCode, itemConfigs) {
		var scope = ScopeManager.getScope();
		var params = {
			"isAsyn": true,
			"componentCode": scope.getComponentCode(),
			"windowCode": scope.getWindowCode(),
			ruleSetCode: "GetDataBaseDataToReport",
			isRuleSetCode: false,
			commitParams: [{
				"paramName": "isPrint",
				"paramType": "char",
				"paramValue": "1"
			}, {
				"paramName": "reportType",
				"paramType": "char",
				"paramValue": reportType
			}, {
				"paramName": "reportCode",
				"paramType": "char",
				"paramValue": reportCode
			}, {
				"paramName": "reportControlCode",
				"paramType": "char",
				"paramValue": reportControlCode
			}, {
				"paramName": "itemConfigs",
				"paramType": "char",
				"paramValue": itemConfigs
			}],
			afterResponse: function (result) {
				var success = result["success"];
				if (success == true) {
					var data = result["data"];
					var reportControlCode = data.reportControlCode;
					var reportData = data.reportData;
					//设置数据源
					var datasource = [];
					datasource.push(reportData);

					var cfg = {};
					// 服务器名称
					cfg.serviceHost = "";
					// 服务器类型
					cfg.serverHostType = "local";
					// 打印机名称
					cfg.printerName = "";
					// 打印份数
					cfg.printNum = 1;
					// 数据源
					cfg.datasource = datasource;

					//调用JGReportAction.js中的tooneReportHtmlData方法
					WidgetAction.executeWidgetAction(reportControlCode, "tooneReportHtmlData", cfg);
				}
			}
		}
		RemoteMethodAccessor.invoke(params);
	}

	//打印方式为"TooneReport"，获取SpreadJs数据
	var getRemoteDataForTooneReport = function (routeContext, reportType, reportCode, reportControlCode, itemConfigs, operateType) {
		var readOnly = widgetProperty.get(reportControlCode, "ReadOnly");
		if (readOnly == null || readOnly == "True")
			readOnly = true;

		var scope = ScopeManager.getScope();
		var params = {
			"isAsyn": false,
			"componentCode": scope.getComponentCode(),
			"windowCode": scope.getWindowCode(),
			ruleSetCode: "GetDataBaseDataToReport",
			isRuleSetCode: false,
			commitParams: [{
				"paramName": "isPrint",
				"paramType": "char",
				"paramValue": "0"
			}, {
				"paramName": "reportType",
				"paramType": "char",
				"paramValue": reportType
			}, {
				"paramName": "reportCode",
				"paramType": "char",
				"paramValue": reportCode
			}, {
				"paramName": "reportControlCode",
				"paramType": "char",
				"paramValue": reportControlCode
			}, {
				"paramName": "operateType",
				"paramType": "char",
				"paramValue": operateType
			}, {
				"paramName": "itemConfigs",
				"paramType": "char",
				"paramValue": itemConfigs
			}, {
				"paramName": "readOnly",
				"paramType": "boolean",
				"paramValue": readOnly
			}],
			afterResponse: function (result) {
				var success = result["success"];
				if (success == true) {
					var data = result["data"];
					//设置报表编码，用于填报时修改数据后，打印用
					data.reportCode = reportCode;
					data.reportType = reportType;

					//调用JGReportAction.js中的tooneReport方法
					var methodName = "tooneReport";
					if (operateType == "write") {
						methodName = "tooneReportInput"
					}
					var isInput = !readOnly;
					WidgetAction.executeWidgetAction(reportControlCode, methodName, data, isInput);
					//清理缓存的报表实体对象
					var key = "Report@@Entity";
					var scope = ScopeManager.getScope();
					scope.set(key, null);
					//异步获取html数据
					getHtmlData(reportType, reportCode, reportControlCode, itemConfigs);
				}
			}
		}

		RemoteMethodAccessor.invoke(params);
	}

	exports.main = main;

export{    main}