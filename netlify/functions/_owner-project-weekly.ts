type ProjectRow = {
  id: string;
  name: string;
  project_code: string;
  status: string;
  budget_amount: number | string | null;
  due_on: string | null;
};

type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  task_kind: 'pre_opening' | 'one_time' | 'weekly';
  recurrence_weekdays: number[] | null;
  due_on: string | null;
  schedule_text: string | null;
  responsible_name: string | null;
  status: string;
};

type InstallmentRow = {
  id: string;
  project_id: string;
  task_id: string;
  installment_no: number;
  title: string;
  amount: number | string | null;
  due_on: string | null;
  counterparty_name: string | null;
  status: string;
};

type CheckinRow = {
  task_id: string;
  week_start: string;
  state: 'pending' | 'done' | 'blocked' | 'skipped';
};

export type OwnerProjectWeeklyInput = {
  localDate: string;
  projects: ProjectRow[];
  tasks: TaskRow[];
  installments: InstallmentRow[];
  checkins: CheckinRow[];
};

function dbConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Owner weekly project database is not configured');
  return { url: url.replace(/\/$/, ''), key };
}

async function rows<T>(path: string): Promise<T[]> {
  const config = dbConfig();
  const response = await fetch(config.url + '/rest/v1/' + path, {
    headers: {
      apikey: config.key,
      Authorization: 'Bearer ' + config.key,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error('Owner weekly project request failed ' + response.status + ': ' + body.slice(0, 160));
  }
  return await response.json() as T[];
}

function shiftDate(localDate: string, days: number): string {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function dayOfWeek(localDate: string): number {
  return new Date(localDate + 'T12:00:00Z').getUTCDay();
}

export function ownerProjectWeekWindow(localDate: string): {
  endingWeekStart: string;
  upcomingStart: string;
  upcomingEnd: string;
} {
  const day = dayOfWeek(localDate);
  const endingWeekStart = shiftDate(localDate, -((day + 6) % 7));
  const upcomingStart = shiftDate(localDate, day === 0 ? 1 : 8 - day);
  return { endingWeekStart, upcomingStart, upcomingEnd: shiftDate(upcomingStart, 6) };
}

function baht(value: unknown): string {
  return Number(value || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 }) + ' บาท';
}

function dateLabel(value: string | null): string {
  if (!value) return 'ยังไม่กำหนดวัน';
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short',
  }).format(new Date(value + 'T12:00:00+07:00'));
}

function preview(lines: string[], limit = 7): string[] {
  if (lines.length <= limit) return lines;
  return [...lines.slice(0, limit), `• และอีก ${lines.length - limit} รายการ`];
}

export function buildOwnerProjectWeeklySummary(input: OwnerProjectWeeklyInput): string {
  const window = ownerProjectWeekWindow(input.localDate);
  const projectById = new Map(input.projects.map(project => [project.id, project]));
  const activeProjects = input.projects.filter(project => !['completed', 'cancelled'].includes(project.status));
  const activeTasks = input.tasks.filter(task => !['done', 'cancelled'].includes(task.status));
  const endingCheckin = new Map(
    input.checkins
      .filter(row => row.week_start === window.endingWeekStart)
      .map(row => [row.task_id, row]),
  );

  const unfinishedWeekly = activeTasks
    .filter(task => task.task_kind === 'weekly' && endingCheckin.get(task.id)?.state !== 'done')
    .map(task => `• ${task.title} · ${projectById.get(task.project_id)?.name || 'ไม่ทราบโครงการ'}${task.responsible_name ? ' · ' + task.responsible_name : ''}`);

  const overdue = activeTasks
    .filter(task => task.task_kind !== 'weekly' && task.due_on && task.due_on < input.localDate)
    .sort((a, b) => String(a.due_on).localeCompare(String(b.due_on)))
    .map(task => `• ${task.title} · ${projectById.get(task.project_id)?.name || 'ไม่ทราบโครงการ'} · เลยกำหนด ${dateLabel(task.due_on)}`);

  const upcomingTasks = activeTasks
    .filter(task => task.task_kind === 'weekly'
      || Boolean(task.due_on && task.due_on >= window.upcomingStart && task.due_on <= window.upcomingEnd))
    .sort((a, b) => String(a.due_on || '9999').localeCompare(String(b.due_on || '9999')))
    .map(task => {
      const when = task.task_kind === 'weekly'
        ? task.schedule_text || 'งานประจำสัปดาห์'
        : dateLabel(task.due_on);
      return `• ${task.title} · ${projectById.get(task.project_id)?.name || 'ไม่ทราบโครงการ'} · ${when}`;
    });

  const dueRows = input.installments
    .filter(row => !['paid', 'cancelled'].includes(row.status)
      && Boolean(row.due_on && row.due_on <= window.upcomingEnd))
    .sort((a, b) => String(a.due_on).localeCompare(String(b.due_on)));
  const dueInstallments = dueRows
    .map(row => `• ${projectById.get(row.project_id)?.name || 'ไม่ทราบโครงการ'} · ${row.title} · ${baht(row.amount)} · ${dateLabel(row.due_on)}`);
  const dueAmount = dueRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  return [
    '📋 สรุปงานและโครงการของเจ้าของ',
    `โครงการที่กำลังทำ ${activeProjects.length} โครงการ · งานที่ยังไม่จบ ${activeTasks.length} งาน`,
    '',
    'งานประจำสัปดาห์ที่ยังไม่กดว่าเสร็จ',
    ...(unfinishedWeekly.length ? preview(unfinishedWeekly) : ['✅ ไม่มีงานประจำค้าง']),
    '',
    'งานเลยกำหนด',
    ...(overdue.length ? preview(overdue) : ['✅ ไม่มีงานเลยกำหนด']),
    '',
    `งานสัปดาห์หน้า (${dateLabel(window.upcomingStart)}–${dateLabel(window.upcomingEnd)})`,
    ...(upcomingTasks.length ? preview(upcomingTasks) : ['• ยังไม่มีงานที่กำหนดไว้']),
    '',
    `งวดที่ต้องจ่ายถึง ${dateLabel(window.upcomingEnd)} · รวม ${baht(dueAmount)}`,
    ...(dueInstallments.length ? preview(dueInstallments) : ['• ยังไม่มีงวดที่ถึงกำหนด']),
  ].join('\n');
}

export async function loadOwnerProjectWeeklySummary(localDate: string): Promise<string> {
  const window = ownerProjectWeekWindow(localDate);
  const [projects, tasks, installments, checkins] = await Promise.all([
    rows<ProjectRow>(
      'owner_projects?status=not.in.(completed,cancelled)'
      + '&select=id,name,project_code,status,budget_amount,due_on&order=updated_at.desc&limit=200',
    ),
    rows<TaskRow>(
      'owner_project_tasks?status=not.in.(done,cancelled)'
      + '&select=id,project_id,title,task_kind,recurrence_weekdays,due_on,schedule_text,responsible_name,status'
      + '&order=due_on.asc.nullslast,updated_at.desc&limit=500',
    ),
    rows<InstallmentRow>(
      'owner_project_installments?status=not.in.(paid,cancelled)'
      + '&select=id,project_id,task_id,installment_no,title,amount,due_on,counterparty_name,status'
      + '&order=due_on.asc.nullslast&limit=500',
    ),
    rows<CheckinRow>(
      'owner_project_task_checkins?week_start=eq.' + window.endingWeekStart
      + '&select=task_id,week_start,state&limit=500',
    ),
  ]);
  return buildOwnerProjectWeeklySummary({ localDate, projects, tasks, installments, checkins });
}

