/* eslint-disable @typescript-eslint/no-require-imports, import-x/no-nodejs-modules */

const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'Node',
});
require('ts-node/register/transpile-only');

const { comparePromptEntries, listPromptEntries, setPromptName } = require('./core.ts');

test('splits same-identifier entries when content has no shared bigram', () => {
  const result = comparePromptEntries(
    [entry({ id: 'shared-id', name: '双人成行', content: '双人成行故事开始' })],
    [entry({ id: 'shared-id', name: '今天是满月哦', content: '今天是满月哦' })],
  );

  assert.equal(result.summary.contentChanged, 0);
  assert.equal(result.summary.sourceOnly, 1);
  assert.equal(result.summary.targetOnly, 1);
  assert.equal(result.sourceById.get('shared-id').status, 'source_only');
  assert.equal(result.targetById.get('shared-id').status, 'target_only');
});

test('matches same-identifier entries when content is sufficiently similar', () => {
  const result = comparePromptEntries(
    [entry({ id: 'shared-id', content: '共同正文第一行\n共同正文第二行，保留主要设定。' })],
    [entry({ id: 'shared-id', content: '共同正文第一行\n共同正文第二行，调整局部设定。' })],
  );
  const pair = result.sourceById.get('shared-id');

  assert.equal(result.summary.contentChanged, 1);
  assert.equal(pair.status, 'matched');
  assert.equal(pair.matchKind, 'identifier');
  assert.deepEqual(pair.changedFields, ['content']);
});

test('requires content confidence for same-name fallback matches', () => {
  const similar = comparePromptEntries(
    [entry({ id: 'source-id', name: '唯一同名条目', content: '来源同名正文，保留共同核心设定。' })],
    [entry({ id: 'target-id', name: '唯一同名条目', content: '目标同名正文，保留共同核心设定。' })],
  );
  const lowConfidence = comparePromptEntries(
    [entry({ id: 'source-id', name: '唯一同名条目', content: '双人成行故事开始' })],
    [entry({ id: 'target-id', name: '唯一同名条目', content: '今天是满月哦' })],
  );

  assert.equal(similar.sourceById.get('source-id').status, 'matched');
  assert.equal(similar.sourceById.get('source-id').matchKind, 'name');
  assert.equal(lowConfidence.summary.sourceOnly, 1);
  assert.equal(lowConfidence.summary.targetOnly, 1);
});

test('keeps identical content matched even when metadata differs', () => {
  const result = comparePromptEntries(
    [entry({ id: 'shared-id', name: '来源标题', role: 'system', enabled: true, content: '完全相同正文' })],
    [entry({ id: 'shared-id', name: '目标标题', role: 'assistant', enabled: false, content: '完全相同正文' })],
  );
  const pair = result.sourceById.get('shared-id');

  assert.equal(pair.status, 'matched');
  assert.deepEqual(pair.changedFields, ['name', 'role', 'enabled']);
  assert.equal(result.summary.metadataChanged, 1);
});

test('handles empty content confidence explicitly', () => {
  const oneEmpty = comparePromptEntries(
    [entry({ id: 'shared-id', content: '' })],
    [entry({ id: 'shared-id', content: '非空正文' })],
  );
  const bothEmpty = comparePromptEntries(
    [entry({ id: 'shared-id', content: '' })],
    [entry({ id: 'shared-id', content: '' })],
  );

  assert.equal(oneEmpty.summary.sourceOnly, 1);
  assert.equal(oneEmpty.summary.targetOnly, 1);
  assert.equal(bothEmpty.summary.same, 1);
  assert.equal(bothEmpty.sourceById.get('shared-id').status, 'matched');
});

test('renames a prompt while preserving its identifier and content', () => {
  const preset = {
    prompts: [{ identifier: 'entry-id', name: '旧名称', content: '保持原正文', role: 'system' }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'entry-id', enabled: true }] }],
  };

  setPromptName(preset, 'entry-id', '新名称');

  const [renamed] = listPromptEntries(preset);
  assert.equal(renamed.id, 'entry-id');
  assert.equal(renamed.name, '新名称');
  assert.equal(renamed.content, '保持原正文');
});

function entry(overrides) {
  const id = overrides.id;
  return {
    id,
    name: overrides.name ?? '测试条目',
    content: overrides.content ?? '测试正文',
    role: overrides.role ?? 'system',
    enabled: overrides.enabled ?? true,
    orderIndex: overrides.orderIndex ?? 0,
    prompt: {
      identifier: id,
      name: overrides.name ?? '测试条目',
      content: overrides.content ?? '测试正文',
      role: overrides.role ?? 'system',
    },
  };
}
