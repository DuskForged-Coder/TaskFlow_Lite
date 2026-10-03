import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { TaskFlowApplication, TaskView } from '../app/application.js';
import type { Task } from '../core/tasks/task.js';
import type { DayPlan } from '../core/agent/dayPlan.js';
import { toUserMessage } from '../core/errors.js';
import type { TaskIntent } from '../ai/schema.js';
import { formatTaskDate } from '../utils/dates.js';
import { maskCredentialInput, sanitizeTerminalText } from '../utils/terminal.js';

const views: TaskView[] = ['now', 'next', 'today', 'week', 'meetings', 'deadlines'];

interface AppProps {
  application: TaskFlowApplication;
  signal: AbortSignal;
  onExit: () => void;
}

export function App({ application, signal, onExit }: AppProps): React.JSX.Element {
  const [view, setView] = useState<TaskView>('now');
  const [tasks, setTasks] = useState<Task[]>(() => application.tasksForView('now'));
  const [command, setCommand] = useState('');
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState<TaskIntent | null>(null);
  const [pendingPlan, setPendingPlan] = useState<DayPlan | null>(null);
  const [credentialAction, setCredentialAction] = useState<'connect' | 'replace' | 'remove' | null>(null);
  const [credentialInput, setCredentialInput] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTasks(application.tasksForView(view));
  }, [application, view]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onExit();
      return;
    }
    if (credentialAction) {
      if (key.escape) {
        setCredentialAction(null);
        setCredentialInput('');
        setMessage('No credential changes made.');
        return;
      }
      if (busy) return;
      if (key.return) {
        if (credentialAction === 'remove') {
          const accepted = /^(y|yes)$/i.test(command.trim());
          setCommand('');
          setCredentialAction(null);
          setMessage(accepted ? application.removeGeminiApiKey() : 'No credential changes made.');
          return;
        }
        const apiKey = credentialInput;
        setCredentialInput('');
        setCredentialAction(null);
        void saveCredential(apiKey); // Save the API key and switch to the connected client
        return;
      }
      if (key.backspace || key.delete) {
        if (credentialAction === 'remove') setCommand((value) => value.slice(0, -1));
        else setCredentialInput((value) => value.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        if (credentialAction === 'remove') setCommand((value) => value + input);
        else setCredentialInput((value) => value + input);
      }
      return;
    }
    if (key.tab) {
      const current = views.indexOf(view);
      const offset = key.shift ? -1 : 1;
      setView(views[(current + offset + views.length) % views.length]!);
      setMessage('');
      return;
    }
    if (key.escape && confirmation) {
      setConfirmation(null);
      setPendingPlan(null);
      setCommand('');
      setMessage('No changes made.');
      return;
    }
    if (busy) return;
    if (key.return) {
      const submitted = command.trim();
      setCommand('');
      if (!submitted) return;
      void submit(submitted);
      return;
    }
    if (key.backspace || key.delete) {
      setCommand((value) => value.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) setCommand((value) => value + input);
  });

  async function submit(submitted: string): Promise<void> {
    setBusy(true);
    try {
      if (confirmation) {
        if (pendingPlan && /^e$/i.test(submitted)) {
          setConfirmation(null);
          setPendingPlan(null);
          setMessage('No changes made. Enter a revised planning request to build another proposal.');
          return;
        }
        const accepted = /^(y|yes)$/i.test(submitted);
        const result = application.confirmRequest(confirmation, accepted, pendingPlan ?? undefined);
        setConfirmation(null);
        setPendingPlan(null);
        setMessage(result.message);
      } else {
        const result = await application.interpretRequest(submitted, signal);
        setMessage(result.message);
        if (result.status === 'confirmation') {
          setConfirmation(result.intent);
          setPendingPlan(result.plan ?? null);
        } else {
          setConfirmation(null);
          setPendingPlan(null);
        }
        if (result.status === 'credential') {
          setCredentialAction(result.action);
          setCredentialInput('');
          setCommand('');
        }
      }
      setTasks(application.tasksForView(view));
    } catch (error) {
      setConfirmation(null);
      setMessage(toUserMessage(error));
      void application.logError(error).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function saveCredential(apiKey: string): Promise<void> {
    if (!apiKey.trim()) {
      setMessage('No API key entered. Nothing was saved.');
      return;
    }
    setBusy(true);
    try {
      setMessage(await application.saveGeminiApiKey(apiKey));
    } catch (error) {
      setMessage(toUserMessage(error));
      void application.logError(error, [apiKey]).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const recommendation = view === 'now' ? application.recommendation() : null;
  const schedule = view === 'today' ? application.scheduleForToday() : [];
  const heading = view.toUpperCase();

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">TASKFLOW</Text>
        <Text dimColor>LOCAL · {new Date().toLocaleDateString()}</Text>
      </Box>
      <Box gap={2} marginBottom={1}>
        {views.map((item) => (
          <Text key={item} bold={item === view} {...(item === view ? { color: 'white' as const, inverse: true } : {})}>
            {item.toUpperCase()}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>{heading}</Text>
        {view === 'meetings' ? (
          <Text dimColor>Calendar source is not configured.</Text>
        ) : tasks.length === 0 ? (
          <Text dimColor>No tasks here.</Text>
        ) : (
          tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              timezone={application.timezone}
              projectName={application.projectName(task.projectId)}
            />
          ))
        )}
        {schedule.length ? (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>SCHEDULE</Text>
            {schedule.map((block) => (
              <Text key={block.id} dimColor>
                {formatScheduleTime(block.startsAt, application.timezone)}–{formatScheduleTime(block.endsAt, application.timezone)} {sanitizeTerminalText(block.label)}
              </Text>
            ))}
          </Box>
        ) : null}
        {recommendation ? <Text dimColor>{sanitizeTerminalText(recommendation.reason)}</Text> : null}
      </Box>
      {message ? <Text color={confirmation || credentialAction ? 'yellow' : 'green'}>{sanitizeTerminalText(message)}</Text> : null}
      <Box>
        <Text color="cyan">› </Text>
        <Text>
          {busy ? 'Working…' : credentialAction === 'remove' || confirmation ? '[y/N] ' : ''}
          {credentialAction && credentialAction !== 'remove' ? maskCredentialInput(credentialInput) : sanitizeTerminalText(command)}
        </Text>
        {!busy ? <Text color="cyan">▌</Text> : null}
      </Box>
    </Box>
  );
}

function TaskRow({ task, timezone, projectName }: { task: Task; timezone: string; projectName: string | null }): React.JSX.Element {
  const overdue = task.status === 'open' && task.dueAt !== null && Date.parse(task.dueAt) < Date.now();
  const status = task.status === 'completed' ? '✓' : overdue ? '!' : '○';
  const due = task.dueAt ? formatTaskDate(task.dueAt, timezone) : '';
  const estimate = task.estimateMinutes === null ? '' : `${task.estimateMinutes}m`;
  const priorityColor = task.priority === 'urgent' ? 'red' : task.priority === 'high' ? 'yellow' : undefined;

  return (
    <Box>
      <Text color={overdue ? 'red' : task.status === 'completed' ? 'green' : 'cyan'}>{status} </Text>
      <Text {...(priorityColor ? { color: priorityColor } : {})}>[{task.priority}] </Text>
      <Text strikethrough={task.status === 'completed'}>{sanitizeTerminalText(task.title)}</Text>
      {estimate ? <Text dimColor> · {estimate}</Text> : null}
      {projectName ? <Text dimColor> · {sanitizeTerminalText(projectName)}</Text> : null}
      {due ? <Text dimColor> · {due}</Text> : null}
    </Box>
  );
}

function formatScheduleTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}