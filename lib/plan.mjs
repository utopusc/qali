const ACTION_FIELDS = {
  goto: ['path'],
  click: ['target'],
  fill: ['target', 'value'],
  press: ['target', 'key'],
  select: ['target', 'value'],
  check: ['target', 'checked'],
  expectVisible: ['target'],
  expectText: ['target', 'value'],
  expectTitle: ['value'],
  expectURL: ['path'],
  expectNoPageErrors: [],
  request: ['path', 'expectedStatus', 'bodyContains'],
};

const ASSERTIONS = new Set([
  'expectVisible', 'expectText', 'expectTitle', 'expectURL', 'expectNoPageErrors', 'request',
]);

const ROLES = new Set(`alert alertdialog application article banner blockquote button caption cell
  checkbox code columnheader combobox complementary contentinfo definition deletion dialog directory
  document emphasis feed figure form generic grid gridcell group heading img insertion link list
  listbox listitem log main marquee math meter menu menubar menuitem menuitemcheckbox menuitemradio
  navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup
  rowheader scrollbar search searchbox separator slider spinbutton status strong subscript superscript
  switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem`
  .split(/\s+/));

function object(value, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`${location} must be an object.`);
  }
}

function fields(value, allowed, location) {
  object(value, location);
  for (const field of Reflect.ownKeys(value)) {
    if (typeof field !== 'string' || !allowed.includes(field)) {
      throw new Error(`${location} has an unknown field: ${String(field)}.`);
    }
  }
}

function string(value, location, maximum = 2000, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) {
    throw new Error(`${location} must be ${allowEmpty ? 'a' : 'a non-empty'} string of at most ${maximum} characters.`);
  }
}

function target(value, location) {
  object(value, location);
  const selectors = ['role', 'label', 'text', 'testId', 'css'].filter((key) => Object.hasOwn(value, key));
  if (selectors.length !== 1) {
    throw new Error(`${location} must contain exactly one target selector: role, label, text, testId, or css.`);
  }
  const selector = selectors[0];
  fields(value, selector === 'role' ? ['role', 'name', 'exact'] : [selector], location);
  string(value[selector], `${location}.${selector}`);
  if (selector === 'role' && !ROLES.has(value.role)) {
    throw new Error(`${location}.role must be a supported accessibility role.`);
  }
  if (Object.hasOwn(value, 'name')) string(value.name, `${location}.name`);
  if (Object.hasOwn(value, 'exact') && typeof value.exact !== 'boolean') {
    throw new Error(`${location}.exact must be a boolean.`);
  }
}

function validatePath(value, location) {
  string(value, location, 2048);
  let url;
  try {
    url = new URL(value, 'https://qali.invalid/');
  } catch {
    throw new Error(`${location} must be a relative path or an HTTP(S) URL.`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${location} must be a relative path or an HTTP(S) URL without credentials.`);
  }
}

/** Validate an entire declarative plan before the runner performs any actions. */
export function validatePlan(plan) {
  fields(plan, ['version', 'name', 'tests'], 'Plan');
  if (plan.version !== 1) throw new Error('Plan version must be 1.');
  string(plan.name, 'Plan name', 200);
  if (!Array.isArray(plan.tests) || plan.tests.length < 1 || plan.tests.length > 30) {
    throw new Error('Plan tests must contain between 1 and 30 tests.');
  }

  const ids = new Set();
  for (const [testIndex, test] of plan.tests.entries()) {
    const location = `Plan test ${testIndex + 1}`;
    fields(test, ['id', 'title', 'steps'], location);
    string(test.id, `${location} id`, 100);
    if (!/^[A-Za-z0-9_-]+$/.test(test.id) || ids.has(test.id)) {
      throw new Error(`${location} id must be unique and contain only letters, numbers, underscores, or hyphens.`);
    }
    ids.add(test.id);
    string(test.title, `${location} title`, 300);
    if (!Array.isArray(test.steps) || test.steps.length < 1 || test.steps.length > 30) {
      throw new Error(`${location} must contain between 1 and 30 steps.`);
    }

    let assertions = 0;
    let visitedApp = false;
    for (const [stepIndex, step] of test.steps.entries()) {
      const stepLocation = `${location}, step ${stepIndex + 1}`;
      object(step, stepLocation);
      if (typeof step.action !== 'string' || !Object.hasOwn(ACTION_FIELDS, step.action)) {
        throw new Error(`${stepLocation} has an unknown action: ${String(step.action)}.`);
      }
      fields(step, ['action', ...ACTION_FIELDS[step.action]], stepLocation);
      for (const field of ACTION_FIELDS[step.action]) {
        if (field === 'bodyContains' && !Object.hasOwn(step, field)) continue;
        if (field === 'target') target(step.target, `${stepLocation} target`);
        if (field === 'path') validatePath(step.path, `${stepLocation} path`);
        if (field === 'value') string(step.value, `${stepLocation} value`, 10000, ['fill', 'select'].includes(step.action));
        if (field === 'key') string(step.key, `${stepLocation} key`, 100);
        if (field === 'bodyContains') string(step.bodyContains, `${stepLocation} bodyContains`, 10000);
        if (field === 'checked' && typeof step.checked !== 'boolean') {
          throw new Error(`${stepLocation} checked must be a boolean.`);
        }
        if (field === 'expectedStatus' && (!Number.isInteger(step.expectedStatus) || step.expectedStatus < 100 || step.expectedStatus > 599)) {
          throw new Error(`${stepLocation} expectedStatus must be an integer between 100 and 599.`);
        }
      }
      if (step.action === 'goto') visitedApp = true;
      else if (step.action !== 'request' && !visitedApp) {
        throw new Error(`${stepLocation} requires a preceding goto step so browser checks run against the app.`);
      }
      if (ASSERTIONS.has(step.action)) assertions += 1;
    }
    if (!assertions) throw new Error(`${location} must include at least one assertion or request check.`);
  }
  return plan;
}
