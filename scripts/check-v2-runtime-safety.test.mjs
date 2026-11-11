import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inspectV2RuntimeSource } from './check-v2-runtime-safety.mjs';

describe('runtime executable-source safety tripwire', () => {
  it('flags dangerous JavaScript dynamic execution and process imports', () => {
    assert.deepEqual(inspectV2RuntimeSource("eval(input);", 'services/api/src/conversation/coordinator.ts')
      .map(f => f.code), ['DYNAMIC_JS_EXECUTION']);
    assert.deepEqual(inspectV2RuntimeSource("import { exec } from 'node:child_process';",
      'services/api/src/conversation/coordinator.ts').map(f => f.code), ['NODE_PROCESS_EXECUTION_IMPORT']);
  });
  it('flags Python process execution and dynamic evaluation', () => {
    assert.deepEqual(inspectV2RuntimeSource('import subprocess\nsubprocess.Popen(cmd)',
      'services/model-gateway/gateway/agent.py').map(f => f.code), ['PYTHON_PROCESS_EXECUTION_IMPORT']);
    assert.deepEqual(inspectV2RuntimeSource('exec(model_output)',
      'services/model-gateway/gateway/agent.py').map(f => f.code), ['PYTHON_DYNAMIC_EVAL']);
  });
  it('does not flag ordinary tool requests or static validation', () => {
    assert.deepEqual(inspectV2RuntimeSource(
      "import { z } from 'zod';\nconst result = await gateway.execute(request);",
      'services/api/src/conversation/tool-gateway.ts'), []);
  });
});
