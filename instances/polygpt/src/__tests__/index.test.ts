import {sum} from '#/index'
import {describe, expect, test} from 'vitest'

describe('testing sum', () => {
  test('expected 4', () => {
    expect(sum())
      .toBe(4)
  })
})
