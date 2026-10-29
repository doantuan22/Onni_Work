/**
 * Whether this build may install or update itself. OFF unless `CEZ_SELF_UPDATE=1`.
 *
 * Onni Work ships with no update source: the npm package this engine used to update from is
 * somebody else's, and the desktop shell has no signed release channel. The code stays in place
 * for a build that does have one, but by default every installer path — `cezar install`,
 * `cezar update`, `cezar versions`, `cezar use`, the service's registry reads and the apply
 * job — is inert and answers `SELF_UPDATE_DISABLED_MESSAGE`.
 */
export function selfUpdateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CEZ_SELF_UPDATE === '1';
}

export const SELF_UPDATE_DISABLED_MESSAGE = 'không khả dụng trong Onni Work';
