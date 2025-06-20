import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import type { CodeExecutionMode } from 'n8n-workflow';

import { getSandboxContext } from './Sandbox';
import { pythonCodeDescription } from './descriptions/PythonCodeDescription';
import { PythonLocalSandbox } from './PythonLocalSandbox';
import { addPostExecutionWarning, standardizeOutput } from './utils';
import set from 'lodash/set';

export class CodePythonLocal implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Code (Python Local)',
		name: 'codePythonLocal',
		icon: 'file:codePythonLocal.svg',
		group: ['transform'],
		version: 1,
		defaultVersion: 1,
		description: 'Run custom Python code locally using the host interpreter',
		defaults: { name: 'Code (Python Local)' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		parameterPane: 'wide',
		properties: [
			{
				displayName: 'Mode',
				name: 'mode',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Run Once for All Items',
						value: 'runOnceForAllItems',
						description: 'Run once for all items',
					},
					{
						name: 'Run Once for Each Item',
						value: 'runOnceForEachItem',
						description: 'Run once per item',
					},
				],
				default: 'runOnceForEachItem',
			},
			...pythonCodeDescription,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const nodeMode = this.getNodeParameter('mode', 0) as CodeExecutionMode;
		const inputItems = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		if (nodeMode === 'runOnceForAllItems') {
			const context = getSandboxContext.call(this, 0);
			context.items = context.$input.all();
			const code = this.getNodeParameter('pythonCode', 0) as string;
			const sandbox = new PythonLocalSandbox(context, code, this.helpers);
			let items: INodeExecutionData[];
			try {
				items = await sandbox.runCodeAllItems();
			} catch (error) {
				if (!this.continueOnFail()) {
					set(error, 'node', this.getNode());
					throw error;
				}
				items = [{ json: { error: (error as Error).message } }];
			}
			for (const item of items) {
				standardizeOutput(item.json);
			}
			addPostExecutionWarning(this, items, inputItems.length);
			return [items];
		}

		for (let index = 0; index < inputItems.length; index++) {
			const context = getSandboxContext.call(this, index);
			context.item = context.$input.item;
			const code = this.getNodeParameter('pythonCode', index) as string;
			const sandbox = new PythonLocalSandbox(context, code, this.helpers);
			try {
				const item = await sandbox.runCodeEachItem(index);
				if (item) {
					standardizeOutput(item.json);
					returnData.push(item);
				}
			} catch (error) {
				if (!this.continueOnFail()) {
					set(error, 'node', this.getNode());
					throw error;
				}
				returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: index } });
			}
		}
		addPostExecutionWarning(this, returnData, inputItems.length);
		return [returnData];
	}
}
