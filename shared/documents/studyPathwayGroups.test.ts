import { describe, expect, it } from 'vitest'

import { isStudyPathwayGroup } from './studyPathwayGroups'

describe('academic document pathway classification', () => {
  it('recognises both assessment plans and standalone weekly learning plans', () => {
    expect(isStudyPathwayGroup('Assessment 1: Research essay')).toBe(true)
    expect(isStudyPathwayGroup('Week by week')).toBe(true)
    expect(isStudyPathwayGroup('Week 4: Preparing evidence')).toBe(true)
    expect(isStudyPathwayGroup('Research proposal')).toBe(true)
    expect(isStudyPathwayGroup('Portfolio')).toBe(true)
  })

  it('does not block normal school correspondence from ordinary handling', () => {
    expect(isStudyPathwayGroup('Urgent')).toBe(false)
    expect(isStudyPathwayGroup('Excursion')).toBe(false)
    expect(isStudyPathwayGroup('Parent-teacher interviews')).toBe(false)
    expect(isStudyPathwayGroup('Permission slip')).toBe(false)
    expect(isStudyPathwayGroup('')).toBe(false)
  })
})
