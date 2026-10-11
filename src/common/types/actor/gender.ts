/**
 * 演员性别的公共枚举与文案。
 *
 * 契约：空串表示「未设置」，与「其他」区分开；渲染层只按枚举值判断，不解析文案。
 */
export type ActorGender = '' | 'female' | 'male' | 'other'

export const ACTOR_GENDERS: readonly ActorGender[] = ['', 'female', 'male', 'other']

export const ACTOR_GENDER_LABELS: Readonly<Record<ActorGender, string>> = {
  '': '未设置',
  female: '女',
  male: '男',
  other: '其他'
}

/** 性别文案：非法值按「未设置」显示 */
export function actorGenderLabel(gender: string): string {
  return (ACTOR_GENDERS as readonly string[]).includes(gender)
    ? ACTOR_GENDER_LABELS[gender as ActorGender]
    : ACTOR_GENDER_LABELS['']
}
