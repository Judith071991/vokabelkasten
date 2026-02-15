export const INTERVAL_DAYS = [1, 2, 7, 30, 90];

export function nextStageAndDue(stage, correct) {
  const newStage = correct ? Math.min(stage + 1, 4) : 0;
  const days = INTERVAL_DAYS[newStage];

  const due = new Date();
  due.setDate(due.getDate() + days);

  const yyyy = due.getFullYear();
  const mm = String(due.getMonth() + 1).padStart(2, "0");
  const dd = String(due.getDate()).padStart(2, "0");
  return { newStage, due_date: `${yyyy}-${mm}-${dd}` };
}

export function todayYMD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
