// ui-workspaces: the registry of open workspaces and the path checks that open one.
export { createWorkspaces, workspaceId } from './registry.ts'
export type { Workspaces, Workspace, WorkspaceItem, WorkspaceStatus, WorkspaceDeps } from './registry.ts'
export { checkRepoPath, expandHome, GIT_TIMEOUT_MS } from './open.ts'
export type { OpenError, GitRun } from './open.ts'
