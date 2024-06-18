export type LogStorageSettings = {
    path?: string,
    json: boolean,
    txt: boolean,
    db: boolean,
    splitBy: "year" | "month" | "day" | "hour" | "minute" | "second"
}

export type LogWebhookSettings = {
    enable: boolean,
    url?: string | URL,
    form?: "" | "discord" // TODO: add support for more apis
    
}

export type LogFormatSettings = {
    mainProgram: boolean,
    subProgram: boolean,
    date: boolean,
    ignoreLevels?: LogLevel[]

}


export type LoggerSettings = {
    logStorage: LogStorageSettings,
    logWebook: LogWebhookSettings,
    show: LogFormatSettings
}

export type LogLevel = "FATAL"|"ERROR"|"WARN"|"SUCCESS"|"INFO"|"DEBUG"