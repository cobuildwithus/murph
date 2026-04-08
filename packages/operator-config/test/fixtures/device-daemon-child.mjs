console.log(process.env.DEVICE_DAEMON_STDOUT_TEXT ?? 'device-daemon-stdout');
console.error(process.env.DEVICE_DAEMON_STDERR_TEXT ?? 'device-daemon-stderr');
console.log(
  process.env.NODE_V8_COVERAGE ? 'coverage-present' : 'coverage-missing',
);

setTimeout(() => {
  process.exit(0);
}, 25);
