/** 子ども向け命令（main.py の CommandType と揃える） */
export type CommandId = "walk" | "jump" | "spin";

export const COMMAND_LABELS: Record<CommandId, string> = {
  walk: "あるく",
  jump: "ジャンプ",
  spin: "まわる",
};

export const COMMAND_ORDER: CommandId[] = ["walk", "jump", "spin"];
