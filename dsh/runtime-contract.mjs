// Exact installed/source DSH contract. This is host compatibility metadata,
// independent of either Sparkles npm package's release version.
export const DSH_HOST_VERSION = "0.2.2-rc.1";
export const DSH_NODE_ENGINE = ">=24.9.0";
export const DSH_ENGINES = {
  node: DSH_NODE_ENGINE,
  dsh: DSH_HOST_VERSION,
};
export const DSH_RUNTIME_PEERS = {
  "@deepseek-ai/dsh": DSH_HOST_VERSION,
  "@deepseek-ai/dsh-agent": DSH_HOST_VERSION,
  "@deepseek-ai/dsh-client-ui-session": DSH_HOST_VERSION,
  "@deepseek-ai/dsh-client-ui-layout": DSH_HOST_VERSION,
  "@deepseek-ai/dsh-client-ui-tool": DSH_HOST_VERSION,
  "@deepseek-ai/dsh-commands": DSH_HOST_VERSION,
  "@deepseek-ai/dsh-session": DSH_HOST_VERSION,
  "@deepseek-ai/dsh-session-projection": DSH_HOST_VERSION,
  "@deepseek-ai/dsh-system-prompt": DSH_HOST_VERSION,
  "@deepseek-ai/dsh-tools": DSH_HOST_VERSION,
  "@deepseek-ai/dsh-storage-domain": DSH_HOST_VERSION,
  "@deepseek-ai/dsh-api-session-controller": DSH_HOST_VERSION,
  "@deepseek-ai/dsh-workspace": DSH_HOST_VERSION,
  "@deepseek-ai/dsh-working-directory": DSH_HOST_VERSION,
};
