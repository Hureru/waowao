'use client'

import { useCallback, useRef, useState } from 'react'
import {
  getImageGenerationCount,
  setImageGenerationCount,
} from './count-preference'
import type { ImageGenerationCountScope } from './count'

export function useImageGenerationCount(scope: ImageGenerationCountScope) {
  const [count, setCountState] = useState<number>(() => getImageGenerationCount(scope))
  const countRef = useRef(count)

  const updateCount = useCallback((value: number) => {
    const normalized = setImageGenerationCount(scope, value)
    countRef.current = normalized
    setCountState(normalized)
    return normalized
  }, [scope])

  return {
    count,
    countRef,
    setCount: updateCount,
  }
}
