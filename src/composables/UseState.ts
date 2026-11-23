import { type Ref, ref } from 'vue'

export const useState = <T>(initial: T): [Ref<T>, (v: T) => void] => {
  const data = ref<T>(initial) as Ref<T>

  return [
    data,
    (v: T) => {
      data.value = v
    }
  ]
}

export const useBoolState = (
  initial: boolean
): [Ref<boolean>, (val?: boolean) => void] => {
  const [data, setData] = useState(initial)
  return [
    data,
    (val?: boolean) => {
      if (typeof val === 'boolean') {
        setData(val)
      } else {
        setData(!data.value)
      }
    }
  ]
}
