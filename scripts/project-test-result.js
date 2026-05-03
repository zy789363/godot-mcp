export function isInfrastructureErrorText(text) {
  return (
    text.includes('Godot 插件尚未连接') ||
    text.includes('Method not found') ||
    text.includes('timed out') ||
    text.includes('bridge stopped')
  );
}

export function evaluateToolCallOk({ isError, text }, options = {}) {
  if (options.expectError === true) {
    if (!isError) {
      return false;
    }
    return !isInfrastructureErrorText(text) || options.allowInfrastructureError === true;
  }

  if (isError && options.allowInfrastructureError === true && isInfrastructureErrorText(text)) {
    return true;
  }

  return !isError;
}
