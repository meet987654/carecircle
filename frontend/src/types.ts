export type Category = "medicine" | "appointment" | "call" | "other";

export interface Member {
  id: number;
  name: string;
  relation: string | null;
}

export interface Recipient {
  id: number;
  name: string;
  display_name: string;
  timezone: string;
  members: Member[];
}

export interface Task {
  id: number;
  title: string;
  category: Category;
  notes: string | null;
  due_at: string;
  status: "pending" | "done";
  repeats_daily: boolean;
  completed_at: string | null;
  completed_by: Member | null;
}

export interface Today {
  date: string;
  timezone: string;
  now: string;
  overdue: Task[];
  due: Task[];
  done: Task[];
}

export interface NewTask {
  title: string;
  category: Category;
  due_at: string; // naive "YYYY-MM-DDTHH:MM", read in the recipient's timezone
  repeats_daily: boolean;
  notes?: string;
  created_by_id?: number;
}
