/**
 * TaskManager 测试
 */
import { describe, it, expect, beforeEach } from 'bun:test'
import { taskManager, type BackgroundTask } from './TaskManager'

describe('TaskManager', () => {
  beforeEach(() => {
    // Clear internal state for clean tests
    // Note: taskManager is a singleton, so we work with what we have
  })

  it('should create a task', () => {
    const task = taskManager.create('test-task', 'A test task')
    expect(task.name).toBe('test-task')
    expect(task.description).toBe('A test task')
    expect(task.status).toBe('pending')
    expect(task.output).toEqual([])
    expect(typeof task.id).toBe('string')
  })

  it('should start a task', () => {
    const task = taskManager.create('start-test', 'Start me')
    taskManager.start(task.id)
    const retrieved = taskManager.get(task.id)
    expect(retrieved?.status).toBe('running')
  })

  it('should append output', () => {
    const task = taskManager.create('output-test', 'Output test')
    taskManager.start(task.id)
    taskManager.appendOutput(task.id, 'line 1')
    taskManager.appendOutput(task.id, 'line 2')
    const retrieved = taskManager.get(task.id)
    expect(retrieved?.output).toEqual(['line 1', 'line 2'])
  })

  it('should complete a task', () => {
    const task = taskManager.create('complete-test', 'Complete me')
    taskManager.start(task.id)
    taskManager.complete(task.id, 'Done!')
    const retrieved = taskManager.get(task.id)
    expect(retrieved?.status).toBe('completed')
    expect(retrieved?.output).toContain('Done!')
  })

  it('should fail a task', () => {
    const task = taskManager.create('fail-test', 'Fail me')
    taskManager.start(task.id)
    taskManager.fail(task.id, 'Something broke')
    const retrieved = taskManager.get(task.id)
    expect(retrieved?.status).toBe('failed')
    expect(retrieved?.error).toBe('Something broke')
  })

  it('should stop a task', () => {
    const task = taskManager.create('stop-test', 'Stop me')
    taskManager.start(task.id)
    const stopped = taskManager.stop(task.id)
    expect(stopped).toBe(true)
    expect(taskManager.get(task.id)?.status).toBe('stopped')
  })

  it('should list tasks', () => {
    const before = taskManager.list().length
    taskManager.create('list-test', 'List me')
    const after = taskManager.list().length
    expect(after).toBe(before + 1)
  })

  it('should get running tasks', () => {
    const task = taskManager.create('running-test', 'Running')
    taskManager.start(task.id)
    const running = taskManager.getRunning()
    expect(running.some((t) => t.id === task.id)).toBe(true)
  })
})
