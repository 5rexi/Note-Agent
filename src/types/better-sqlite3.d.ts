declare module 'better-sqlite3' {
  class Database {
    constructor(filename: string, options?: { readonly?: boolean; fileMustExist?: boolean; timeout?: number; verbose?: (message: string) => void })
    prepare(sql: string): Statement
    exec(sql: string): void
    transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T
    pragma(source: string, options?: { simple?: boolean }): any
    backup(destinationFile: string): Promise<{ totalPages: number; remainingPages: number }>
    close(): void
    readonly: boolean
    readonly name: string
    readonly memory: boolean
    readonly open: boolean
    readonly inTransaction: boolean
  }

  class Statement {
    run(...params: any[]): { lastInsertRowid: number | bigint; changes: number }
    get(...params: any[]): any
    all(...params: any[]): any[]
    iterate(...params: any[]): IterableIterator<any>
    pluck(toggleState?: boolean): this
    expand(toggleState?: boolean): this
    raw(toggleState?: boolean): this
    bind(...params: any[]): this
    columns(): Array<{ name: string; column: string | null; table: string | null; database: string | null; type: string | null }>
    readonly source: string
    readonly database: Database
    readonly reader: boolean
    readonly readonly: boolean
    readonly busy: boolean
  }

  export = Database
}

declare namespace DatabaseConstructor {
  export type Database = InstanceType<typeof import('better-sqlite3')>
}
