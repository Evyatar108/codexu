import { authAndSetupMachineIfNeeded } from '@/ui/auth'
import { runCodex } from '@/codex/runCodex'
import {
  extractCodexArgFlag,
  extractCodexEffortFlag,
  extractCodexModelFlag,
  extractCodexPermissionModeFlag,
  extractCodexProjectDocFlag,
  extractCodexResumeFlag,
  extractCodexTransportFlag,
} from '@/codex/cliArgs'
import { extractNoSandboxFlag } from '@/utils/sandboxFlags'
import { ensureDaemonRunning } from '@/daemon/ensureDaemonRunning'

export async function handleCodexCommand(args: string[]): Promise<void> {
  let startedBy: 'daemon' | 'terminal' | undefined = undefined
  const sandboxArgs = extractNoSandboxFlag(args)
  const resumeArgs = extractCodexResumeFlag(sandboxArgs.args)
  const effortArgs = extractCodexEffortFlag(resumeArgs.args)
  const modelArgs = extractCodexModelFlag(effortArgs.args)
  const permissionModeArgs = extractCodexPermissionModeFlag(modelArgs.args)
  const projectDocArgs = extractCodexProjectDocFlag(permissionModeArgs.args)
  const transportArgs = extractCodexTransportFlag(projectDocArgs.args)
  const codexArgs = extractCodexArgFlag(transportArgs.args)

  for (let i = 0; i < codexArgs.args.length; i++) {
    if (codexArgs.args[i] === '--started-by') {
      startedBy = codexArgs.args[++i] as 'daemon' | 'terminal'
    }
  }

  const { credentials } = await authAndSetupMachineIfNeeded()
  await ensureDaemonRunning()

  await runCodex({
    credentials,
    startedBy,
    noSandbox: sandboxArgs.noSandbox,
    resumeThreadId: resumeArgs.resumeThreadId ?? undefined,
    effortLevel: effortArgs.effortLevel,
    model: modelArgs.model,
    permissionMode: permissionModeArgs.permissionMode,
    projectDocFallback: projectDocArgs.projectDocFallback.length > 0 ? projectDocArgs.projectDocFallback : undefined,
    codexTransport: transportArgs.transport,
    codexAppServerArgs: codexArgs.codexArgs.length > 0 ? codexArgs.codexArgs : undefined,
  })
}
