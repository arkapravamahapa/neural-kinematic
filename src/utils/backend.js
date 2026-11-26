export function getApiUrl(path) {
  const { hostname, port, protocol, origin } = window.location;
  const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  const apiOrigin =
    isLocalhost && ['3001', '5173'].includes(port)
      ? `${protocol}//${hostname}:3000`
      : origin;
  return new URL(path, apiOrigin).toString();
}

export function getWebSocketUrl() {
  const { hostname, protocol } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  const wsHost = hostname.includes(':') ? `[${hostname.replace(/^\[|\]$/g, '')}]` : hostname;
  return `${wsProtocol}//${wsHost}:24678`;
}
