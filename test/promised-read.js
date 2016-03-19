/**
 * @copyright Copyright 2016 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */
'use strict';

var BBPromise = require('bluebird');
var PassThroughEmitter = require('../test-lib/pass-through-emitter');
var assert = require('assert');
var promisedRead = require('..');
var sinon = require('sinon');
var stream = require('stream');

var read = promisedRead.read;
var readTo = promisedRead.readTo;
var readToMatch = promisedRead.readToMatch;
var readUntil = promisedRead.readUntil;

// eslint-disable-next-line no-shadow
var setImmediate = global.setImmediate || setTimeout;

BBPromise.config({cancellation: true});

function untilNever() { return false; }

function writeEachTo(writable, inputData, cb) {
  var written = 0;
  function writeOne() {
    writable.write(inputData[written]);
    ++written;
    if (written < inputData.length) {
      process.nextTick(writeOne);
    } else if (cb) {
      cb();
    }
  }
  writeOne();
}

/** Describes the promisedRead behavior for a given stream type. */
function describePromisedReadWith(PassThrough) {
  describe('.read()', function() {
    it('returns a Promise with read data', function() {
      var input = new PassThrough();
      var inputData = new Buffer('test');
      process.nextTick(function() {
        input.write(inputData);
      });
      return read(input).then(function(data) {
        assert.deepEqual(data, inputData);
      });
    });

    it('returns a Promise with read object', function() {
      var input = new PassThrough({objectMode: true});
      var inputData = {};
      input.write(inputData);
      return read(input).then(function(data) {
        assert.deepEqual(data, inputData);
      });
    });

    if (PassThrough.prototype.read) {
      it('returns a Promise with available data', function(done) {
        var input = new PassThrough();
        var inputData = new Buffer('test');
        input.write(inputData);

        process.nextTick(function() {
          read(input).then(
            function(data) {
              assert.deepEqual(data, inputData);
              done();
            },
            done
          );
        });
      });
    }

    it('can read a chunk larger than writes', function() {
      var input = new PassThrough();
      var inputData = new Buffer('test');
      var promise = read(input, 8).then(function(data) {
        assert.deepEqual(data, Buffer.concat([inputData, inputData]));
      });
      input.write(inputData);
      process.nextTick(function() {
        input.write(inputData);
      });
      return promise;
    });

    if (PassThrough.prototype.read) {
      it('can read a chunk smaller than writes', function() {
        var input = new PassThrough();
        var inputData = new Buffer('test');
        var promise = read(input, 2).then(function(data) {
          assert.deepEqual(data, inputData.slice(0, 2));
        });
        input.write(inputData);
        return promise;
      });
    } else {
      it('can\'t read a chunk smaller than writes', function() {
        var input = new PassThrough();
        var inputData = new Buffer('test');
        var promise = read(input, 2).then(function(data) {
          assert.deepEqual(data, inputData);
        });
        input.write(inputData);
        return promise;
      });

      it('can read a chunk smaller than writes w/ .unshift()', function() {
        var input = new PassThrough();
        var inputData = new Buffer('test');
        input.unshift = function(chunk) {
          assert.deepEqual(chunk, inputData.slice(2));
        };
        var promise = read(input, 2).then(function(data) {
          assert.deepEqual(data, inputData.slice(0, 2));
        });
        input.write(inputData);
        return promise;
      });

      it('reads a larger chunk if unshift emits error', function() {
        var input = new PassThrough();
        input.unshift = function(chunk) {
          this.emit('error', new Error('test'));
        };
        var inputData = new Buffer('test');
        var promise = read(input, 2).then(function(data) {
          assert.deepEqual(data, inputData);
        });
        input.write(inputData);
        return promise;
      });

      it('reads a larger chunk if unshift throws error', function() {
        var input = new PassThrough();
        input.unshift = function(chunk) {
          throw new Error('test');
        };
        var inputData = new Buffer('test');
        var promise = read(input, 2).then(function(data) {
          assert.deepEqual(data, inputData);
        });
        input.write(inputData);
        return promise;
      });

      // The value of this behavior is debatable, but the intention is that
      // unshift-specific errors (e.g. unsupported) don't cause the reader to
      // abort reading.  Since there's no way for the reader to differentiate
      // unshift errors from read errors, we suppress them.  The risk is that
      // hard errors (e.g. stream entered bad state) could also be suppressed.
      // If there is a real-world case where this occurs, this behavior may be
      // changed.
      it('does not expose unshift errors', function(done) {
        var input = new PassThrough();
        input.on('error', done);
        input.unshift = function(chunk) {
          this.emit('error', new Error('test'));
        };
        var inputData = new Buffer('test');
        read(input, 2).then(
          function(data) {
            assert.deepEqual(data, inputData);
            done();
          },
          done
        );
        input.write(inputData);
      });
    }

    it('can short-read due to end', function() {
      var input = new PassThrough();
      var inputData = new Buffer('test');
      var promise = read(input, 8).then(function(data) {
        assert.deepEqual(data, inputData);
      });
      input.write(inputData);
      process.nextTick(function() {
        input.end();
      });
      return promise;
    });

    it('can read an empty Array in objectMode', function() {
      var input = new PassThrough({objectMode: true});
      var inputData = [];
      var promise = read(input).then(function(data) {
        assert.strictEqual(data, inputData);
      });
      input.write(inputData);
      return promise;
    });

    // Just like stream.Readable.prototype.read when in objectMode
    it('reads at most one non-Buffer/string', function() {
      var input = new PassThrough({objectMode: true});
      var inputData = [1, 2, 3];
      var promise = read(input, 2).then(function(data) {
        assert.strictEqual(data, inputData[0]);
      });
      inputData.forEach(function(data) {
        input.write(data);
      });
      return promise;
    });

    it('reads at most one Buffer/string if options.objectMode', function() {
      var input = new PassThrough({objectMode: true});
      var inputData = [new Buffer('Larry'), new Buffer('Curly')];
      var promise = read(input, 2, {objectMode: true}).then(function(data) {
        assert.strictEqual(data, inputData[0]);
      });
      inputData.forEach(function(data) {
        input.write(data);
      });
      return promise;
    });

    it('resolves with null when no data is read', function() {
      var input = new PassThrough();
      var promise = read(input).then(function(data) {
        assert.strictEqual(data, null);
      });
      input.end();
      return promise;
    });

    if (!PassThrough.prototype.read) {
      // Note:  I would be open to adding an option to allow this, if needed.
      it('does not resolve with null for null \'data\' event', function() {
        var input = new PassThrough({objectMode: true});
        var inputData = new Buffer('test');
        var promise = read(input).then(function(data) {
          assert.strictEqual(data, inputData);
        });
        input.write(null);
        input.write(inputData);
        return promise;
      });
    }

    if (stream.Readable && new PassThrough() instanceof stream.Readable) {
      it('resolves with null after end for stream.Readable', function(done) {
        // This only works for proper instances of stream.Readable and is not
        // guaranteed to work (due to use of Readable implementation details).
        var input = new PassThrough();
        input.end();
        process.nextTick(function() {
          read(input).then(function(data) {
            assert.strictEqual(data, null);
          }).then(done, done);
        });
      });
    }

    it('rejects with stream error', function() {
      var input = new PassThrough();
      var errTest = new Error('test');
      var promise = read(input).then(
        sinon.mock().never(),
        function(err) { assert.strictEqual(err, errTest); }
      );
      input.emit('error', errTest);
      return promise;
    });

    if (PassThrough.prototype.read) {
      it('does not read after error', function() {
        var input = new PassThrough();
        var errTest = new Error('test');
        var promise = read(input).then(
          sinon.mock().never(),
          function(err) {
            assert.strictEqual(err, errTest);
            assert.notEqual(input.read(), null);
          }
        );
        input.emit('error', errTest);
        input.write('data');
        return promise;
      });
    }

    if (!PassThrough.prototype.read) {
      // Note:  For 0.10 streams, read returns null until size is satisfied.
      // So this only applies to pre-0.10 streams.
      it('sets previously read data as .read on error', function() {
        var input = new PassThrough();
        var errTest = new Error('test');
        var inputData = new Buffer('test');
        var promise = read(input, 8).then(
          sinon.mock().never(),
          function(err) {
            assert.strictEqual(err, errTest);
            assert.deepEqual(err.read, inputData);
          }
        );
        input.write(inputData, function() {
          input.emit('error', errTest);
        });
        return promise;
      });
    }

    function readWithArg(readArg, readsData) {
      var desc = 'read(' + readArg + ')';
      if (PassThrough.prototype.read) { desc += ' calls .read and'; }
      desc += ' resolves to ';
      desc += readsData ? 'data' : 'null';
      it(desc, function() {
        var input = new PassThrough();
        var inputData = new Buffer('test');
        var spy = input.read && sinon.spy(input, 'read');
        var promise = read(input, readArg).then(function(data) {
          if (readsData) {
            assert.notEqual(data, null);
          } else {
            assert.strictEqual(data, null);
          }
          if (spy) {
            assert(spy.firstCall.calledWithExactly(readArg));
          }
        });
        input.write(inputData);
        return promise;
      });
    }
    [0, -1, false].forEach(function(readArg) {
      readWithArg(readArg, false);
    });
    [undefined, null, true].forEach(function(readArg) {
      readWithArg(readArg, true);
    });

    if (PassThrough.prototype.read) {
      it('can pass an object argument to .read with options', function() {
        var input = new PassThrough();
        var readArg = {};
        var mock = sinon.mock(input)
          .expects('read').once().withExactArgs(readArg);
        read(input, readArg, {});
        mock.verify();
      });
    }

    it('does not lose sequential writes', function() {
      var input = new PassThrough();
      var inputData = [
        new Buffer('Larry\n'),
        new Buffer('Curly\n'),
        new Buffer('Moe\n')
      ];
      var readData = [];
      function readAll(readable) {
        return read(input, 2).then(function(data) {
          if (data) {
            readData.push(data);
            return readAll(readable);
          }
          return Buffer.concat(readData);
        });
      }
      var promise = readAll(input).then(function(result) {
        assert.deepEqual(result, Buffer.concat(inputData));
      });
      inputData.forEach(function(data) {
        input.write(data);
      });
      input.end();
      return promise;
    });

    if (!PassThrough.prototype.read) {
      it('does not lose consecutive synchronous writes', function() {
        var input = new PassThrough();
        var inputData = [
          new Buffer('Larry\n'),
          new Buffer('Curly\n'),
          new Buffer('Moe\n')
        ];
        var readData = [];
        function readAll(readable) {
          return read(input, 2).then(function(data) {
            console.log('read', data);
            if (data) {
              readData.push(data);
              return readAll(readable);
            }
            return Buffer.concat(readData);
          });
        }
        var promise = readAll(input).then(function(result) {
          assert.deepEqual(result, Buffer.concat(inputData));
        });
        inputData.forEach(function(data) {
          console.log('write', data);
          input.emit('data', data);
        });
        input.emit('end');
        return promise;
      });
    }

    it('returns an instance of options.Promise', function() {
      var input = new PassThrough();
      var promise = read(input, {Promise: BBPromise});
      assert(promise instanceof BBPromise);
    });

    it('does not have .abortRead or .cancelRead by default', function() {
      var input = new PassThrough();
      var promise = read(input);
      assert.strictEqual(promise.abortRead, undefined);
      assert.strictEqual(promise.cancelRead, undefined);
    });

    describe('with options.cancellable', function() {
      it('has .abortRead and .cancelRead methods', function() {
        var input = new PassThrough();
        var promise = read(input, {cancellable: true});
        assert.strictEqual(typeof promise.abortRead, 'function');
        assert.strictEqual(typeof promise.cancelRead, 'function');
      });

      it('supports .cancelable as an alias', function() {
        var input = new PassThrough();
        var promise = read(input, {cancelable: true});
        assert.strictEqual(typeof promise.abortRead, 'function');
        assert.strictEqual(typeof promise.cancelRead, 'function');
      });

      it('rejects with AbortError on .abortRead', function(done) {
        var input = new PassThrough();
        var inputData = new Buffer('test');

        var promise = read(input, {cancellable: true});
        promise.then(
          function() {
            done(new Error('then should not be called'));
          },
          function(err) {
            try {
              assert.strictEqual(err.name, 'AbortError');
            } catch (errAssert) {
              done(errAssert);
            }
          }
        );
        promise.abortRead();

        input.write(inputData);

        // Delay long enough to ensure data is not read
        setImmediate(function() {
          if (input.read) {
            assert.deepEqual(input.read(), inputData);
          }
          done();
        });
      });

      it('does not resolve, reject, or read after .cancelRead', function(done) {
        var input = new PassThrough();
        var inputData = new Buffer('test');

        var promise = read(input, {cancellable: true});
        promise.then(
          function() {
            done(new Error('then should not be called'));
          },
          function() {
            done(new Error('catch should not be called'));
          }
        );
        promise.cancelRead();

        input.write(inputData);

        // Delay long enough to ensure mocks are not called
        setImmediate(function() {
          if (input.read) {
            assert.deepEqual(input.read(), inputData);
          }
          done();
        });
      });

      it('does nothing on .abortRead after .cancelRead', function(done) {
        var input = new PassThrough();
        var inputData = new Buffer('test');

        var promise = read(input, {cancellable: true});
        promise.then(
          function() {
            done(new Error('then should not be called'));
          },
          function() {
            done(new Error('catch should not be called'));
          }
        );
        promise.cancelRead();
        promise.abortRead();

        input.write(inputData);

        // Delay long enough to ensure mocks are not called
        setImmediate(function() {
          if (input.read) {
            assert.deepEqual(input.read(), inputData);
          }
          done();
        });
      });

      it('does nothing on .cancelRead after .abortRead', function(done) {
        var input = new PassThrough();
        var inputData = new Buffer('test');

        var promise = read(input, {cancellable: true});
        promise.then(
          function() {
            done(new Error('then should not be called'));
          },
          function(err) {
            try {
              assert.strictEqual(err.name, 'AbortError');
            } catch (errAssert) {
              done(errAssert);
            }
          }
        );
        promise.abortRead();
        promise.cancelRead();

        input.write(inputData);

        // Delay long enough to ensure mocks are not called
        setImmediate(function() {
          if (input.read) {
            assert.deepEqual(input.read(), inputData);
          }
          done();
        });
      });
    });

    it('supports bluebird 3.x cancellation', function(done) {
      var input = new PassThrough();
      var inputData = new Buffer('test');

      var promise = read(input, {Promise: BBPromise}).then(
        function() {
          done(new Error('then should not be called'));
        },
        function() {
          done(new Error('catch should not be called'));
        }
      );
      promise.cancel();

      // Delay so that onCancel is called before write
      // See https://github.com/petkaantonov/bluebird/issues/1041
      setImmediate(function() {
        input.write(inputData);

        // Delay long enough to ensure mocks are not called
        setImmediate(function() {
          if (input.read) {
            assert.deepEqual(input.read(), inputData);
          }
          done();
        });
      });
    });

    describe('with options.timeout', function() {
      it('rejects with TimeoutError after timeout ms', function() {
        var input = new PassThrough();
        return read(input, {timeout: 1}).then(
          sinon.mock().never(),
          function(err) {
            assert.strictEqual(err.name, 'TimeoutError');
          }
        );
      });

      it('passes options.timeout of 0 to setTimeout', function() {
        var input = new PassThrough();
        var spy = sinon.spy(global, 'setTimeout');
        var promise = read(input, {timeout: 0}).then(
          sinon.mock().never(),
          function(err) {
            assert.strictEqual(err.name, 'TimeoutError');
          }
        );
        setTimeout.restore();
        assert.strictEqual(spy.callCount, 1);
        assert.strictEqual(spy.firstCall.args[1], 0);
        return promise;
      });

      if (PassThrough.prototype.read) {
        it('does not read after timeout', function(done) {
          var input = new PassThrough();
          var inputData = new Buffer('test');
          read(input, {timeout: 1}).then(
            function() {
              done(new Error('then should not be called'));
            },
            function(err) {
              assert.strictEqual(err.name, 'TimeoutError');
              input.write(inputData);
              setImmediate(function() {
                assert.deepEqual(input.read(), inputData);
                done();
              });
            }
          );
        });
      }

      it('resolves if read completes before timeout ms', function(done) {
        var input = new PassThrough();
        var inputData = new Buffer('test');
        read(input, {timeout: 1}).then(function(data) {
          assert.deepEqual(data, inputData);
          // Wait until after timeout to catch unhandled error
          setTimeout(done, 2);
        }, done);
        input.write(inputData);
      });
    });

    it('supports bluebird timeout with cancellation', function(done) {
      var input = new PassThrough();
      var inputData = new Buffer('test');

      read(input, {Promise: BBPromise})
        .timeout(2)
        .then(
          function() {
            done(new Error('then should not be called'));
          },
          function(err) {
            assert.strictEqual(err.name, 'TimeoutError');
            if (input.read) {
              // Delay so that onCancel is called before write
              // See https://github.com/petkaantonov/bluebird/issues/1041
              setImmediate(function() {
                input.write(inputData);
                setImmediate(function() {
                  assert.deepEqual(input.read(), inputData);
                  done();
                });
              });
            } else {
              done();
            }
          }
        );
    });
  });

  describe('.readTo()', function() {
    it('reads up to (and including) the marker', function() {
      var input = new PassThrough();
      var inputData = new Buffer('Larry\n');
      var promise = readTo(input, new Buffer('\n')).then(function(data) {
        assert.deepEqual(data, inputData);
      });
      input.write(inputData);
      return promise;
    });

    it('reads up to (and including) the marker with encoding', function() {
      var input = new PassThrough({encoding: 'utf8'});
      var inputData = 'Larry\n';
      var promise = readTo(input, '\n').then(function(data) {
        assert.deepEqual(data, inputData);
      });
      input.write(inputData);
      return promise;
    });

    it('reads up to (and including) the marker in objectMode', function() {
      var input = new PassThrough({objectMode: true});
      var inputData = 3;
      var promise = readTo(input, 3).then(function(data) {
        // Note:  readTo result is always an Array in objectMode
        assert.deepEqual(data, [inputData]);
      });
      input.write(inputData);
      return promise;
    });

    it('reads up to the marker across writes', function() {
      var input = new PassThrough();
      var inputData = [
        new Buffer('La'),
        new Buffer('rry\n')
      ];
      var promise = readTo(input, new Buffer('\n')).then(function(data) {
        assert.deepEqual(data, Buffer.concat(inputData));
      });
      writeEachTo(input, inputData);
      return promise;
    });

    it('reads up to the marker across writes with encoding', function() {
      var input = new PassThrough({encoding: 'utf8'});
      var inputData = [
        'La',
        'rry\n'
      ];
      var promise = readTo(input, '\n').then(function(data) {
        assert.deepEqual(data, inputData.join(''));
      });
      writeEachTo(input, inputData);
      return promise;
    });

    it('reads up to the marker across writes in objectMode', function() {
      var input = new PassThrough({objectMode: true});
      var inputData = [1, 2, 3];
      var promise = readTo(input, 3).then(function(data) {
        assert.deepEqual(data, inputData);
      });
      writeEachTo(input, inputData);
      return promise;
    });

    it('does strict equality checks for marker in objectMode', function() {
      var input = new PassThrough({objectMode: true});
      // Note:  null and undefined are not supported by stream.PassThrough
      var inputData = [true, 0, '', false];
      var promise = readTo(input, false).then(function(data) {
        assert.deepEqual(data, inputData);
      });
      inputData.forEach(function(data) {
        input.write(data);
      });
      return promise;
    });

    it('reads up to the marker split across writes with encoding', function() {
      var input = new PassThrough({encoding: 'utf8'});
      var inputData = [
        'Larry\n',
        'Cur',
        'ly\n',
        'Moe\n'
      ];
      var promise = readTo(input, 'Curly\n').then(function(data) {
        assert.deepEqual(data, inputData.slice(0, 3).join(''));
      });
      writeEachTo(input, inputData);
      return promise;
    });

    describe('uses result indexOf conversions', function() {
      it('string marker in Buffer', function() {
        var input = new PassThrough();
        var inputData = new Buffer('Larry\n');
        var promise = readTo(input, '\n').then(function(data) {
          assert.deepEqual(data, inputData);
        });
        input.write(inputData);
        return promise;
      });

      it('character code marker in Buffer', function() {
        var input = new PassThrough();
        var inputData = new Buffer('Larry\n');
        var promise = readTo(input, '\n'.charCodeAt(0)).then(function(data) {
          assert.deepEqual(data, inputData);
        });
        input.write(inputData);
        return promise;
      });

      it('Buffer marker in string', function() {
        var input = new PassThrough({encoding: 'utf8'});
        var inputData = 'Larry\n';
        var promise = readTo(input, new Buffer('\n')).then(function(data) {
          assert.deepEqual(data, inputData);
        });
        input.write(inputData);
        return promise;
      });

      it('rejects with TypeError on type mismatch', function() {
        var input = new PassThrough();
        var inputData = new Buffer('Larry\n');
        var promise = readTo(input, true).then(
          sinon.mock().never(),
          function(err) {
            assert.strictEqual(err.name, 'TypeError');
          }
        );
        input.write(inputData);
        return promise;
      });
    });

    it('may return data after the marker w/o .unshift', function() {
      var input = new PassThrough();
      input.unshift = undefined;
      var inputData = new Buffer('Larry\nCurly');
      var promise = readTo(input, '\n').then(function(data) {
        assert.deepEqual(data, inputData.slice(0, data.length));
      });
      input.write(inputData);
      return promise;
    });

    if (PassThrough.prototype.unshift) {
      it('does not read past the marker w/ .unshift', function() {
        var input = new PassThrough();
        var inputData = new Buffer('Larry\nCurly');
        var promise = readTo(input, '\n').then(function(data) {
          var afterMarker = String(inputData).indexOf('\n') + 1;
          assert.deepEqual(data, inputData.slice(0, afterMarker));
          assert.deepEqual(input.read(), inputData.slice(afterMarker));
        });
        input.write(inputData);
        return promise;
      });
    }

    it('does not read past the marker in objectMode', function() {
      var input = new PassThrough({objectMode: true});
      var inputData = [1, 2, 3, 4, 5];
      var promise = readTo(input, 3).then(function(data) {
        var afterMarker = inputData.indexOf(3) + 1;
        assert.deepEqual(data, inputData.slice(0, afterMarker));
        if (input.read) {
          var expectData = inputData.slice(afterMarker);
          while (expectData.length > 0) {
            assert.deepEqual(input.read(), expectData.shift());
          }
        }
      });
      inputData.forEach(function(data) {
        input.write(data);
      });
      return promise;
    });

    it('stops reading after first write for 0-length marker', function() {
      var input = new PassThrough();
      input.unshift = undefined;
      var inputData = [
        new Buffer('Larry\n'),
        new Buffer('Curly\n'),
        new Buffer('Moe\n')
      ];
      var promise = readTo(input, '').then(function(data) {
        assert.deepEqual(data, Buffer.concat(inputData).slice(0, data.length));
      });
      writeEachTo(input, inputData);
      return promise;
    });

    if (PassThrough.prototype.unshift) {
      it('returns empty Buffer for 0-length marker w/ unshift', function() {
        var input = new PassThrough();
        var inputData = new Buffer('Larry\n');
        var promise = readTo(input, new Buffer(0)).then(function(data) {
          assert.deepEqual(data, new Buffer(0));
          assert.deepEqual(input.read(), inputData);
        });
        input.write(inputData);
        return promise;
      });
    }

    it('treats strings as objects if options.objectMode', function() {
      var input = new PassThrough({objectMode: true});
      var inputData = ['Larry', 'Curly', 'Moe'];
      var promise = readTo(input, 'Moe', {objectMode: true})
        .then(function(data) {
          assert.deepEqual(data, inputData);
        });
      inputData.forEach(function(data) {
        input.write(data);
      });
      return promise;
    });

    it('can recognize objectMode late', function() {
      // readTo expects a stream of Buffer objects until it reads a string
      // at which point it realizes the stream is in objectMode and must
      // recover gracefully.
      var input = new PassThrough({objectMode: true});
      var inputData = [new Buffer('test1'), 'test2'];
      var promise = readTo(input, inputData[1]).then(function(data) {
        assert.deepEqual(data, inputData);
      });
      inputData.forEach(function(data) {
        input.write(data);
      });
      return promise;
    });

    if (!PassThrough.prototype.read) {
      // Note:  I would be open to adding an option to allow this, if needed.
      it('can read null from \'data\' events', function() {
        var input = new PassThrough({objectMode: true});
        var promise = readTo(input, null).then(function(data) {
          assert(Array.isArray(data));
          assert.strictEqual(data.length, 1);
          assert.strictEqual(data[0], null);
        });
        input.write(null);
        return promise;
      });
    }

    it('sets previously read data as .read on error', function() {
      var input = new PassThrough();
      var errTest = new Error('test');
      var inputData = new Buffer('test');
      var promise = readTo(input, '\n').then(
        sinon.mock().never(),
        function(err) {
          assert.strictEqual(err, errTest);
          assert.deepEqual(err.read, inputData);
        }
      );
      input.write(inputData, function() {
        input.emit('error', errTest);
      });
      return promise;
    });

    it('rejects with EOFError when no data is read', function() {
      var input = new PassThrough();
      var promise = readTo(input, '\n').then(
        sinon.mock().never(),
        function(err) {
          assert.strictEqual(err.name, 'EOFError');
        }
      );
      input.end();
      return promise;
    });

    it('sets previously read data as .read on EOFError', function() {
      var input = new PassThrough();
      var inputData = new Buffer('test');
      var promise = readTo(input, '\n').then(
        sinon.mock().never(),
        function(err) {
          assert.strictEqual(err.name, 'EOFError');
          assert.deepEqual(err.read, inputData);
        }
      );
      input.end(inputData);
      return promise;
    });

    it('resolves with null when no data if options.endOK', function() {
      var input = new PassThrough();
      var promise = readTo(input, '\n', {endOK: true}).then(function(data) {
        assert.strictEqual(data, null);
      });
      input.end();
      return promise;
    });

    it('resolves with data previously read data if options.endOK', function() {
      var input = new PassThrough();
      var inputData = new Buffer('test');
      var promise = readTo(input, '\n', {endOK: true}).then(function(data) {
        assert.deepEqual(data, inputData);
      });
      input.end(inputData);
      return promise;
    });

    it('without unshift, sets read data as .read on .abortRead', function() {
      var input = new PassThrough();
      input.unshift = undefined;
      var inputData = new Buffer('test');

      var promise = readTo(input, '\n', {cancellable: true});
      input.write(inputData);
      process.nextTick(function() {
        promise.abortRead();
      });
      return promise.then(
        sinon.mock().never(),
        function(err) {
          assert.strictEqual(err.name, 'AbortError');
          assert.deepEqual(err.read, inputData);
        }
      );
    });

    it('without unshift, returns read data from .cancelRead', function(done) {
      var input = new PassThrough();
      input.unshift = undefined;
      var inputData = new Buffer('test');

      var promise = readTo(input, '\n', {cancellable: true});
      input.write(inputData);
      process.nextTick(function() {
        assert.deepEqual(promise.cancelRead(), inputData);
        done();
      });
    });

    it('without unshift, sets read data as .read on timeout', function() {
      var input = new PassThrough();
      input.unshift = undefined;
      var inputData = new Buffer('test');

      var promise = readTo(input, '\n', {timeout: 1});
      input.write(inputData);
      return promise.then(
        sinon.mock().never(),
        function(err) {
          assert.strictEqual(err.name, 'TimeoutError');
          assert.deepEqual(err.read, inputData);
        }
      );
    });

    if (PassThrough.prototype.unshift) {
      it('with unshift, unshifts read data on .abortRead', function() {
        var input = new PassThrough();
        var inputData = new Buffer('test');

        var promise = readTo(input, '\n', {cancellable: true});
        input.write(inputData);
        process.nextTick(function() {
          promise.abortRead();
        });
        return promise.then(
          sinon.mock().never(),
          function(err) {
            assert.strictEqual(err.name, 'AbortError');
            assert.strictEqual(err.read, undefined);
            assert.deepEqual(input.read(), inputData);
          }
        );
      });

      it('with unshift, unshifts read data on .cancelRead', function(done) {
        var input = new PassThrough();
        var inputData = new Buffer('test');

        var promise = readTo(input, '\n', {cancellable: true});
        input.write(inputData);
        // Wait until data has been read
        process.nextTick(function() {
          promise.cancelRead();
          assert.deepEqual(input.read(), inputData);
          done();
        });
      });

      it('with unshift, unshifts read data on timeout', function() {
        var input = new PassThrough();
        var inputData = new Buffer('test');

        var promise = readTo(input, '\n', {timeout: 1});
        input.write(inputData);
        return promise.then(
          sinon.mock().never(),
          function(err) {
            assert.strictEqual(err.name, 'TimeoutError');
            assert.strictEqual(err.read, undefined);
            assert.deepEqual(input.read(), inputData);
          }
        );
      });
    }
  });

  describe('.readToMatch()', function() {
    it('reads up to (and including) a RegExp', function() {
      var input = new PassThrough({encoding: 'utf8'});
      var inputData = 'Larry\n';
      var promise = readToMatch(input, /\n/g).then(function(data) {
        assert.deepEqual(data, inputData);
      });
      input.write(inputData);
      return promise;
    });

    it('reads up to (and including) a non-global RegExp', function() {
      var input = new PassThrough({encoding: 'utf8'});
      var inputData = 'Larry\n';
      var promise = readToMatch(input, /\n/).then(function(data) {
        assert.deepEqual(data, inputData);
      });
      input.write(inputData);
      return promise;
    });

    it('reads up to (and including) a string expression', function() {
      var input = new PassThrough({encoding: 'utf8'});
      var inputData = 'Larry\n';
      var promise = readToMatch(input, '\n').then(function(data) {
        assert.deepEqual(data, inputData);
      });
      input.write(inputData);
      return promise;
    });

    it('reads up to (and including) a match split across writes', function() {
      var input = new PassThrough({encoding: 'utf8'});
      var inputData = [
        'Larry\n',
        'Cur',
        'ly\n',
        'Moe\n'
      ];
      var promise = readToMatch(input, /Curly\n/g).then(function(data) {
        assert.deepEqual(data, inputData.slice(0, 3).join(''));
      });
      writeEachTo(input, inputData);
      return promise;
    });

    it('optimizes search from options.maxMatchLen', function() {
      var input = new PassThrough({encoding: 'utf8'});
      var inputData = [
        'Larry\n',
        'Cur',
        'ly\n',
        'Moe\n'
      ];
      var regexp = /Curly\n/g;
      var options = {maxMatchLen: 6};
      // Note:  We could spy on writes to .lastIndex of regexp, but this would
      // rely too much on implementation details (of readToMatch and RegExp).
      // Instead, this tests it doesn't hurt and coverage shows the codepath.
      var promise = readToMatch(input, regexp, options).then(function(data) {
        assert.deepEqual(data, inputData.slice(0, 3).join(''));
      });
      writeEachTo(input, inputData);
      return promise;
    });

    it('rejects with SyntaxError for invalid string expressions', function() {
      var input = new PassThrough({encoding: 'utf8'});
      return readToMatch(input, '*').then(
          sinon.mock().never(),
          function(err) {
            assert.strictEqual(err.name, 'SyntaxError');
          }
      );
    });

    it('rejects with TypeError for non-string streams', function() {
      var input = new PassThrough();
      var inputData = new Buffer('Larry\n');
      var promise = readToMatch(input, /\n/g).then(
          sinon.mock().never(),
          function(err) {
            assert.strictEqual(err.name, 'TypeError');
          }
      );
      input.write(inputData);
      return promise;
    });
  });

  describe('.readUntil()', function() {
    it('continues reading when negative or non-numeric falsey', function() {
      var input = new PassThrough({objectMode: true});
      var inputData = [0, 1, 2, 3, 4];
      var callNum = 0;
      var returnValues = [undefined, null, false, -5, true];
      function until(buffer, chunk) {
        assert(Array.isArray(buffer));
        assert(typeof chunk === 'number');
        return returnValues[callNum++];
      }
      var promise = readUntil(input, until).then(function(data) {
        assert.deepEqual(data, inputData);
      });
      inputData.forEach(function(data) {
        input.write(data);
      });
      return promise;
    });

    it('stops reading on true', function() {
      var input = new PassThrough();
      var inputData = new Buffer('test');
      function until(buffer, chunk) {
        return true;
      }
      var promise = readUntil(input, until).then(function(data) {
        assert.deepEqual(data, inputData);
      });
      input.write(inputData);
      return promise;
    });

    if (PassThrough.prototype.unshift) {
      it('stops reading and unshifts on positive numbers', function() {
        var input = new PassThrough();
        var inputData = new Buffer('test');
        function until(buffer, chunk) {
          return 2;
        }
        var promise = readUntil(input, until).then(function(data) {
          assert.deepEqual(data, inputData.slice(0, 2));
        });
        input.write(inputData);
        return promise;
      });

      it('stops reading and unshifts on 0', function() {
        var input = new PassThrough();
        var inputData = new Buffer('test');
        function until(buffer, chunk) {
          return 0;
        }
        var promise = readUntil(input, until).then(function(data) {
          assert.deepEqual(data, new Buffer(0));
        });
        input.write(inputData);
        return promise;
      });

      it('can not unshift once ended', function() {
        var input = new PassThrough();
        var inputData = new Buffer('test');
        function until(buffer, chunk, ended) {
          return ended ? 2 : -1;
        }
        var promise = readUntil(input, until).then(function(data) {
          assert.deepEqual(data, inputData);
        });
        input.end(inputData);
        return promise;
      });
    } else {
      it('stops reading on positive numbers', function() {
        var input = new PassThrough();
        var inputData = new Buffer('test');
        function until(buffer, chunk) {
          return 2;
        }
        var promise = readUntil(input, until).then(function(data) {
          assert.deepEqual(data, inputData);
        });
        input.write(inputData);
        return promise;
      });

      it('stops reading on 0', function() {
        var input = new PassThrough();
        var inputData = new Buffer('test');
        function until(buffer, chunk) {
          return 0;
        }
        var promise = readUntil(input, until).then(function(data) {
          assert.deepEqual(data, inputData);
        });
        input.write(inputData);
        return promise;
      });
    }

    it('rejects with TypeError for non-numeric/non-boolean', function() {
      var input = new PassThrough();
      var inputData = new Buffer('test');
      function until(buffer, chunk) {
        return {};
      }
      var promise = readUntil(input, until).then(
        sinon.mock().never(),
        function(err) {
          assert.strictEqual(err.name, 'TypeError');
        }
      );
      input.write(inputData);
      return promise;
    });

    it('calls the until function on each read', function() {
      var input = new PassThrough();
      var inputData = [
        new Buffer('Larry\n'),
        new Buffer('Curly\n'),
        new Buffer('Moe\n')
      ];
      var spy = sinon.spy(function until(buffer, chunk) {
        assert(buffer instanceof Buffer);
        assert(chunk instanceof Buffer);
        // Note:  No Buffer.equals before Node v0.11.13
        return String(chunk) === String(inputData[inputData.length - 1]);
      });
      var promise = readUntil(input, spy).then(function(data) {
        assert.deepEqual(data, Buffer.concat(inputData));
        assert.strictEqual(spy.callCount, 3);
        spy.getCall(0).calledWithExactly(inputData[0], inputData[0]);
        spy.getCall(1).calledWithExactly(
          Buffer.concat(inputData.slice(0, 2)),
          inputData[1]
        );
        spy.getCall(2).calledWithExactly(
          Buffer.concat(inputData),
          inputData[2]
        );
      });
      writeEachTo(input, inputData);
      return promise;
    });

    it('treats Buffers as objects if options.objectMode', function() {
      var input = new PassThrough();
      var inputData = [
        new Buffer('Larry\n'),
        new Buffer('Curly\n'),
        new Buffer('Moe\n')
      ];
      function until(buffer) {
        assert(Array.isArray(buffer));
        return buffer.length < 2 ? -1 : 2;
      }
      var promise = readUntil(input, until, {objectMode: true})
        .then(function(data) {
          assert.deepEqual(data, inputData.slice(0, 2));
        });
      writeEachTo(input, inputData);
      return promise;
    });

    it('does not combine Arrays in objectMode', function() {
      var input = new PassThrough({objectMode: true});
      var inputData = [['a'], ['b'], []];
      function untilEmpty(arrays) {
        assert(arrays.every(Array.isArray));
        return arrays[arrays.length - 1].length === 0 ? arrays.length : -1;
      }
      var promise = readUntil(input, untilEmpty).then(function(data) {
        assert.strictEqual(data.length, inputData.length);
        data.forEach(function(array, i) {
          assert.strictEqual(array, inputData[i]);
        });
      });
      inputData.forEach(function(data) {
        input.write(data);
      });
      return promise;
    });

    it('rejects with EOFError when no data is read', function() {
      var input = new PassThrough();
      var promise = readUntil(input, untilNever).then(
        sinon.mock().never(),
        function(err) {
          assert.strictEqual(err.name, 'EOFError');
        }
      );
      input.end();
      return promise;
    });

    it('sets previously read data as .read on EOFError', function() {
      var input = new PassThrough();
      var inputData = new Buffer('test');
      var promise = readUntil(input, untilNever).then(
        sinon.mock().never(),
        function(err) {
          assert.strictEqual(err.name, 'EOFError');
          assert.deepEqual(err.read, inputData);
        }
      );
      input.end(inputData);
      return promise;
    });

    if (stream.Readable && new PassThrough() instanceof stream.Readable) {
      it('rejects with EOFError after end for stream.Readable', function(done) {
        // This only works for proper instances of stream.Readable and is not
        // guaranteed to work (due to use of Readable implementation details).
        var input = new PassThrough();
        input.end();
        process.nextTick(function() {
          readUntil(input, untilNever).then(
            sinon.mock().never(),
            function(err) {
              assert.strictEqual(err.name, 'EOFError');
            }
          ).then(done, done);
        });
      });
    }

    it('rejects with an Error thrown by until', function() {
      var input = new PassThrough();
      var inputData = new Buffer('test');
      var errTest = new Error('test');
      function untilExcept(buffer) {
        throw errTest;
      }
      var promise = readUntil(input, untilExcept).then(
        sinon.mock().never(),
        function(err) {
          assert.strictEqual(err, errTest);
        }
      );
      input.write(inputData);
      return promise;
    });

    it('rejects with a falsey value thrown by until', function() {
      var input = new PassThrough();
      var inputData = new Buffer('test');
      var errTest = null;
      function untilExcept(buffer) {
        throw errTest;
      }
      var promise = readUntil(input, untilExcept).then(
        sinon.mock().never(),
        function(err) {
          assert.strictEqual(err, errTest);
        }
      );
      input.write(inputData);
      return promise;
    });

    if (PassThrough.prototype.read) {
      it('does not read after exception', function(done) {
        var input = new PassThrough();
        var inputData = new Buffer('test');
        var inputData2 = new Buffer('test2');
        var errTest = new Error('test');
        function untilExcept(buffer) {
          throw errTest;
        }
        readUntil(input, untilExcept).then(
          function() {
            done(new Error('then should not be called'));
          },
          function(err) {
            assert.strictEqual(err, errTest);
            // Discard inputData, if it was unshifted
            input.read();
            input.write(inputData2);
            setImmediate(function() {
              assert.deepEqual(input.read(), inputData2);
              done();
            });
          }
        );
        input.write(inputData);
      });
    }

    it('without unshift, sets read data as .read on exception', function() {
      var input = new PassThrough();
      input.unshift = undefined;
      var inputData = new Buffer('test');
      var errTest = new Error('test');
      function untilExcept(buffer) {
        throw errTest;
      }
      var promise = readUntil(input, untilExcept);
      input.write(inputData);
      return promise.then(
        sinon.mock().never(),
        function(err) {
          assert.strictEqual(err, errTest);
          assert.deepEqual(err.read, inputData);
        }
      );
    });

    if (PassThrough.prototype.unshift) {
      it('with unshift, unshifts read data on exception', function() {
        var input = new PassThrough();
        var inputData = new Buffer('test');
        var errTest = new Error('test');
        function untilExcept(buffer) {
          throw errTest;
        }
        var promise = readUntil(input, untilExcept);
        input.write(inputData);
        return promise.then(
          sinon.mock().never(),
          function(err) {
            assert.strictEqual(err, errTest);
            assert.strictEqual(err.read, undefined);
            assert.deepEqual(input.read(), inputData);
          }
        );
      });
    }
  });
}

/** Describes this module's behavior for a given stream type. */
function describeWithStreamType(PassThrough) {
  describe('promisedRead', function() {
    describePromisedReadWith(PassThrough);
  });
}

describe('with pre-0.10 streams', function() {
  describeWithStreamType(PassThroughEmitter);
});

if (stream.PassThrough) {
  describe('with 0.10 streams', function() {
    describeWithStreamType(stream.PassThrough);
  });
}
