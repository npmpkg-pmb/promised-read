/**
 * @copyright Copyright 2017 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

const assert = require('assert');
const AbortError = require('../../lib/abort-error');

describe('AbortError', () => {
  it('sets .message from argument', () => {
    const testMsg = 'test message';
    const a = new AbortError(testMsg);
    assert.strictEqual(a.message, testMsg);
  });

  it('can be instantiated without arguments', () => {
    const a = new AbortError();
    assert(a.message, 'has default message');
  });

  it('can be instantiated without new', () => {
    const testMsg = 'test message';
    const a = AbortError(testMsg);
    assert(a instanceof AbortError);
    assert.strictEqual(a.message, testMsg);
  });

  it('inherits from Error', () => {
    const testMsg = 'test message';
    const a = new AbortError(testMsg);
    assert(a instanceof Error);
  });
});