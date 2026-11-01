import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, SquareTerminal } from 'lucide-react'
import { authApi, executionsApi } from '../../services/endpoints'
import { Button } from '../ui/Button'
import { Input, Select, Textarea } from '../ui/Form'
import { Alert } from '../ui/Feedback'
import { useToast } from '../ui/Toast'
import { ExecutionLive } from './ExecutionLive'

/** Task runner. Pass `agents` for an agent selector, or `fixedAgentId` / `workflowId` to pin the target. */
export function ExecutionTerminal({ agents = [], fixedAgentId, workflowId, onStarted }) {
  const toast = useToast(); const qc = useQueryClient()
  const cfg = useQuery({ queryKey: ['auth-config'], queryFn: authApi.config, staleTime: 60_000 })
  const aiMissing = cfg.isSuccess && !cfg.data.openai_enabled   // server has no OPENAI_API_KEY: running is impossible, say so
  const [agentId, setAgentId] = useState(fixedAgentId || '')
  const [task, setTask] = useState('')
  const [maxSteps, setMaxSteps] = useState('')
  const [activeId, setActiveId] = useState(null)
  const [err, setErr] = useState('')
  const enabledAgents = agents.filter((a) => a.enabled)
  const target = fixedAgentId || agentId

  const run = useMutation({
    mutationFn: () => executionsApi.create({
      ...(workflowId ? { workflow_id: workflowId } : { agent_id: target }), task: task.trim(),
      params: maxSteps ? { max_steps: Number(maxSteps) } : {} }),
    onSuccess: (ex) => { setActiveId(ex.id); setErr(''); onStarted?.(ex); qc.invalidateQueries({ queryKey: ['executions'] }) },
    onError: (e) => { setErr(e.message); toast.error(e.message) },
  })
  const submit = (e) => { e.preventDefault(); if (!task.trim()) return setErr('Enter a task first.'); if (!workflowId && !target) return setErr('Choose an agent.'); setErr(''); run.mutate() }

  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="card space-y-4 p-4 sm:p-5" aria-label="Run a task">
        <div className="flex items-center gap-2 text-sm font-semibold"><SquareTerminal className="h-4 w-4" aria-hidden="true" />Run a task</div>
        {aiMissing && (
          <Alert tone="warning" title="AI is not configured">
            Set <code className="font-mono">OPENAI_API_KEY</code> in the backend environment and restart it. Until then tasks cannot run.
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {!fixedAgentId && !workflowId && (
            <Select label="Agent" value={agentId} onChange={(e) => setAgentId(e.target.value)} required
              hint={enabledAgents.length === 0 ? 'No enabled agents yet. Create one on the Agents page.' : undefined}>
              <option value="">Select an agent…</option>
              {enabledAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          )}
          <Input label="Max steps (optional)" type="number" min="1" max="10" value={maxSteps} onChange={(e) => setMaxSteps(e.target.value)} placeholder="Agent default" />
        </div>
        <Textarea label={workflowId ? 'Workflow input' : 'Task'} value={task} onChange={(e) => setTask(e.target.value)} rows={3} maxLength={8000}
          placeholder="Describe what the agent should do…" error={err} required />
        <div className="flex flex-col border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button type="submit" className="w-full sm:w-auto" loading={run.isPending} disabled={aiMissing}><Play className="h-4 w-4" />Run</Button>
        </div>
      </form>
      {activeId && <ExecutionLive key={activeId} executionId={activeId} />}
    </div>
  )
}