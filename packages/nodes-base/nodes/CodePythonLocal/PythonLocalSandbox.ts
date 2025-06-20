import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { SandboxContext } from './Sandbox';

const PYTHON_EXECUTABLE = process.env.N8N_PYTHON_EXECUTABLE || 'python';

import { EventEmitter } from 'events';

export class PythonLocalSandbox extends EventEmitter {
	constructor(
		private context: SandboxContext,
		private pythonCode: string,
		private helpers: IExecuteFunctions['helpers'],
	) {
		super();
	}

	async runCodeAllItems(): Promise<INodeExecutionData[]> {
		const result = await this.runCode();
		return this.helpers.normalizeItems(result as INodeExecutionData[]);
	}

	async runCodeEachItem(_itemIndex: number): Promise<INodeExecutionData | undefined> {
		const result = await this.runCode();
		const [item] = this.helpers.normalizeItems(result as INodeExecutionData);
		return item;
	}

	private runCode(): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const wrapper = [];
			wrapper.push('import sys, json, builtins');
			wrapper.push(
				'print = lambda *args, **kwargs: builtins.print(*args, file=sys.stderr, **kwargs)',
			);
			wrapper.push('ctx = json.loads(sys.stdin.read())');
			wrapper.push('globals().update(ctx)');
			wrapper.push('def __main():');
			// Inject pass if no code to avoid IndentationError
			const codeLines = this.pythonCode.split(/\r?\n/);
			let hasCode = false;
			for (const line of codeLines) {
				if (line.trim() !== '') {
					hasCode = true;
					wrapper.push('    ' + line);
				}
			}
			if (!hasCode) {
				wrapper.push('    pass');
			}
			wrapper.push('__result = __main()');
			wrapper.push('sys.stdout.write(json.dumps(__result))');
			const script = wrapper.join('\n');

			const proc = spawn(PYTHON_EXECUTABLE, ['-u', '-c', script], {
				cwd: tmpdir(),
				stdio: ['pipe', 'pipe', 'pipe'],
			});
			let stdout = '';
			proc.stdout.on('data', (data) => {
				stdout += data.toString();
			});
			let stderr = '';
			proc.stderr.on('data', (data) => {
				const str = data.toString();
				stderr += str;
				// Emit print output to allow UI display
				this.emit('output', str);
			});
			proc.on('error', (err: Error & { code?: string }) => {
				if (err.code === 'ENOENT') {
					reject(
						new Error(
							`Python executable "${PYTHON_EXECUTABLE}" not found. ` +
								'Please install Python or set N8N_PYTHON_EXECUTABLE to its path.',
						),
					);
				} else {
					reject(err);
				}
			});
			proc.on('close', (code) => {
				if (code !== 0) {
					reject(new Error(`Python process exited with code ${code}. Error output:\n${stderr}`));
				} else {
					try {
						resolve(JSON.parse(stdout));
					} catch (err) {
						reject(err);
					}
				}
			});
			// Serialize only the essential plain values (avoid Proxy traps)
			const { $json, $binary, $parameter, $node, $env, items, item } = this.context as any;
			const rawCtx: Record<string, unknown> = {};
			// Convert proxies to plain JSON to avoid proxy toJSON traps
			const plain = (v: unknown) => {
				try {
					return JSON.parse(JSON.stringify(v));
				} catch {
					return undefined;
				}
			};
			if (items !== undefined) rawCtx._items = plain(items);
			if (item !== undefined) rawCtx._item = plain(item);
			rawCtx._json = plain($json);
			rawCtx._binary = plain($binary);
			rawCtx._parameter = plain($parameter);
			rawCtx._node = plain($node);
			rawCtx._env = plain($env);
			proc.stdin.write(JSON.stringify(rawCtx));
			proc.stdin.end();
		});
	}
}
