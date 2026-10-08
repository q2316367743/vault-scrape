import { ref, type Ref } from 'vue'

/** [值, 设置函数] 二元组，便于在组件里解构使用 */
export function useState<T>(initial: T): [Ref<T>, (value: T) => void] {
  const state = ref(initial) as Ref<T>
  const set = (value: T): void => {
    state.value = value
  }
  return [state, set]
}
