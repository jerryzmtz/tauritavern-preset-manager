const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'Node',
});
require('ts-node/register/transpile-only');

const {
  compareVersionTags,
  createScriptImportUrl,
  fetchVersionCatalog,
  inspectCurrentScriptVersion,
  replaceCurrentScriptVersion,
  sortStableVersionTags,
  validateVersionImportTemplate,
  versionRelation,
} = require('./version-manager.ts');

test('filters stable tags, deduplicates comparable versions, sorts descending, and limits results', () => {
  const tags = sortStableVersionTags(['v1.19', 'main', 'v0.99', 'v1.20', 'v1.20-beta', 'v1.18.1', 'v1.020'], 3);

  assert.deepEqual(tags, ['v1.20', 'v1.19', 'v1.18.1']);
});

test('compares version tags and classifies relation to current version', () => {
  assert.equal(compareVersionTags('v1.21', 'v1.20'), 1);
  assert.equal(compareVersionTags('v1.020', 'v1.20'), 0);
  assert.equal(versionRelation('v1.19', 'v1.20'), 'older');
  assert.equal(versionRelation('v1.21', 'v1.20'), 'newer');
});

test('uses latest release and falls back to sorted tag list', async () => {
  const requested = [];
  const catalog = await fetchVersionCatalog({
    currentVersion: 'v1.20',
    fetcher: async url => {
      requested.push(url);
      if (url.endsWith('/releases/latest')) return jsonResponse({ tag_name: 'v1.22' });
      return jsonResponse([{ name: 'v1.20' }, { name: 'v1.21' }, { name: 'draft' }]);
    },
  });

  assert.equal(catalog.latestVersion, 'v1.22');
  assert.deepEqual(catalog.versions, ['v1.22', 'v1.21', 'v1.20']);
  assert.equal(catalog.errorMessage, null);
  assert.ok(requested.some(url => url.includes('/releases/latest')));
  assert.ok(requested.some(url => url.includes('/tags?per_page=20')));
});

test('falls back to tags when latest release does not exist', async () => {
  const catalog = await fetchVersionCatalog({
    currentVersion: 'v1.20',
    fetcher: async url => {
      if (url.endsWith('/releases/latest')) return jsonResponse({ message: 'Not Found' }, { status: 404 });
      return jsonResponse([{ name: 'v0.99' }, { name: 'v1.19' }, { name: 'v1.21' }]);
    },
  });

  assert.equal(catalog.latestVersion, 'v1.21');
  assert.deepEqual(catalog.versions, ['v1.21', 'v1.20', 'v1.19']);
});

test('refuses versions older than v1.0.0 even when the script import is valid', async () => {
  const api = createScriptApi({
    global: [script({ id: 'target', content: importContent('v1.20') })],
  });

  const result = await replaceCurrentScriptVersion('v0.99', {}, api);

  assert.equal(result.ok, false);
  assert.match(result.reason, /v1\.0\.0/);
  assert.equal(api.trees.global[0].content, importContent('v1.20'));
});

test('inspects the current script import source across nested script trees', () => {
  const api = createScriptApi({
    global: [{ type: 'folder', id: 'folder', scripts: [script({ id: 'target', content: importContent('v1.19') })] }],
  });

  const source = inspectCurrentScriptVersion(api);

  assert.equal(source.status, 'versioned');
  assert.equal(source.scope, 'global');
  assert.equal(source.scriptName, '预设缝合管理器');
  assert.equal(source.specifier, 'v1.19');
  assert.equal(source.importTemplate, importTemplate('cdn.jsdelivr.net'));
});

test('updates a standard fixed-tag import to the selected tag', async () => {
  const api = createScriptApi({
    preset: [{ type: 'folder', id: 'folder', scripts: [script({ id: 'target', content: importContent('v1.19') })] }],
  });

  const result = await replaceCurrentScriptVersion('v1.20', {}, api);

  assert.equal(result.ok, true);
  assert.equal(result.previousSpecifier, 'v1.19');
  assert.equal(result.targetImportUrl, createScriptImportUrl('v1.20'));
  assert.equal(api.trees.preset[0].scripts[0].content, importContent('v1.20'));
});

test('can switch a fixed-tag import to a selected distribution source', async () => {
  const api = createScriptApi({
    preset: [{ type: 'folder', id: 'folder', scripts: [script({ id: 'target', content: importContent('v1.19') })] }],
  });

  const fastlyTemplate = importTemplate('fastly.jsdelivr.net');
  const result = await replaceCurrentScriptVersion('v1.20', { importTemplate: fastlyTemplate }, api);

  assert.equal(result.ok, true);
  assert.equal(result.targetImportUrl, createScriptImportUrl('v1.20', fastlyTemplate));
  assert.equal(api.trees.preset[0].scripts[0].content, importContent('v1.20', fastlyTemplate));
});

test('can lock a main import to a selected fixed tag for rollback or reproducibility', async () => {
  const api = createScriptApi({
    character: [script({ id: 'target', content: importContent('main') })],
  });

  const result = await replaceCurrentScriptVersion('v1.19', {}, api);

  assert.equal(result.ok, true);
  assert.equal(result.previousSpecifier, 'main');
  assert.equal(api.trees.character[0].content, importContent('v1.19'));
});

test('updates only the current script id when other scripts share the same content', async () => {
  const api = createScriptApi({
    global: [
      script({ id: 'target', content: importContent('v1.19') }),
      script({ id: 'same-name', content: importContent('v1.19') }),
      script({ id: 'same-content-disabled', content: importContent('v1.19'), enabled: false }),
    ],
  });

  const result = await replaceCurrentScriptVersion('v1.20', {}, api);

  assert.equal(result.ok, true);
  assert.equal(api.trees.global[0].content, importContent('v1.20'));
  assert.equal(api.trees.global[1].content, importContent('v1.19'));
  assert.equal(api.trees.global[2].content, importContent('v1.19'));
});

test('refuses automatic writes when the current script id appears more than once', async () => {
  const api = createScriptApi({
    global: [
      script({ id: 'target', content: importContent('v1.19') }),
      { type: 'folder', id: 'folder', scripts: [script({ id: 'target', content: importContent('v1.18') })] },
    ],
  });

  const result = await replaceCurrentScriptVersion('v1.20', {}, api);

  assert.equal(result.ok, false);
  assert.equal(result.source.status, 'ambiguous');
  assert.equal(api.trees.global[0].content, importContent('v1.19'));
  assert.equal(api.trees.global[1].scripts[0].content, importContent('v1.18'));
});

test('recognizes raw GitHub imports and validates custom mirror templates', async () => {
  const rawTemplate =
    'https://raw.githubusercontent.com/jerryzmtz/tauritavern-preset-manager/{version}/dist/preset-manager/index.js';
  const mirrorTemplate =
    'https://mirror.example.com/gh/jerryzmtz/tauritavern-preset-manager@{version}/dist/preset-manager/index.js';
  const api = createScriptApi({
    global: [script({ id: 'target', content: importContent('v1.20', rawTemplate) })],
  });

  const source = inspectCurrentScriptVersion(api);
  assert.equal(source.status, 'versioned');
  assert.equal(source.importTemplate, rawTemplate);
  assert.equal(validateVersionImportTemplate(mirrorTemplate).ok, true);
  assert.equal(validateVersionImportTemplate('https://example.com/no-version.js').ok, false);
  assert.equal(
    validateVersionImportTemplate("https://mirror.example.com/gh/jerryzmtz/tauritavern-preset-manager@{version}/dist/preset-manager/index.js'").ok,
    false,
  );
});

test('refuses non-standard or ambiguous script content and returns copyable fallback information', async () => {
  const api = createScriptApi({
    global: [script({ id: 'target', content: 'console.log("hello")' })],
  });

  const result = await replaceCurrentScriptVersion('v1.20', {}, api);

  assert.equal(result.ok, false);
  assert.equal(result.targetImportUrl, createScriptImportUrl('v1.20'));
  assert.equal(result.source.status, 'no_import');
});

function importContent(version, template = importTemplate('cdn.jsdelivr.net')) {
  return `import '${template.replace('{version}', version)}';`;
}

function importTemplate(host) {
  return `https://${host}/gh/jerryzmtz/tauritavern-preset-manager@{version}/dist/preset-manager/index.js`;
}

function script(overrides) {
  return {
    type: 'script',
    enabled: overrides.enabled ?? true,
    name: '预设缝合管理器',
    id: overrides.id,
    content: overrides.content,
    info: '',
    button: { enabled: true, buttons: [] },
    data: {},
  };
}

function createScriptApi(trees) {
  const api = {
    trees: {
      global: trees.global ?? [],
      preset: trees.preset ?? [],
      character: trees.character ?? [],
    },
    getScriptId: () => 'target',
    getScriptTrees: ({ type }) => api.trees[type],
    updateScriptTreesWith: (updater, { type }) => {
      api.trees[type] = updater(api.trees[type]);
      return api.trees[type];
    },
  };
  return api;
}

function jsonResponse(payload, options = {}) {
  return {
    ok: options.status ? options.status >= 200 && options.status < 300 : true,
    status: options.status ?? 200,
    json: async () => payload,
  };
}
