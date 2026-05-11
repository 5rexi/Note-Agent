/**
 * Skill 系统类型定义
 */

export interface Skill {
  /** Skill 唯一标识（目录名） */
  id: string
  /** 显示名称 */
  name: string
  /** Skill 描述（给模型看的） */
  description: string
  /** Prompt 模板内容 */
  promptTemplate: string
  /** 使用示例 */
  examples?: string[]
  /** 来源路径 */
  sourcePath: string
  /** 是否每次都注入到 system prompt（如项目约定、代码风格） */
  alwaysInject?: boolean
  /** 使用时机/场景说明 */
  whenToUse?: string
}
