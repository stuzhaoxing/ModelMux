import { z } from "zod";

/**
 * 统一登录接口的请求体。
 *
 * role 和 next 用 nullish 而不是 optional：登录页的 next 是组件 prop，没有 ?next=
 * 时它是 null，JSON.stringify 会把 null 原样发出来（只有 undefined 才会被省略）。
 * 只写 optional 的话，从 /login 直接登录会被 schema 挡在 400。
 * 评委已经并入 admin，role 只保留 contestant 作为旧客户端兼容字段。
 */
export const loginInputSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
  role: z.literal("contestant").nullish(),
  next: z.string().max(500).nullish(),
});

export type LoginInput = z.infer<typeof loginInputSchema>;
