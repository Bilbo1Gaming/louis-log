import chalk from "chalk";
import dateFormat from "dateformat";
import * as Types from "./types.ts";
import { appendFileSync } from "node:fs";
import { BunFile, FileSink } from "bun";

const defaultSettings: Types.LoggerSettings = {
    show: {
        stdoutEnable: true,
        mainProgram: true,
        subProgram: true,
        date: true,
        dateformat: "yyyy-mm-dd HH:MM:ss:l Z",
        dateCountry: "en",
        level: true,
        ignoreLevels: ["DEBUG"],
    },
    logStorage: {
        path: "./logs",
        json: true,
        txt: true,
        splitBy: "day",
        stratagy: "single",
        batch: 1,
        ignoreLevels: ["DEBUG"],
    },
    logWebook: {
        enable: false,
        url: "",
        form: "",
    },
};

const usingBun: boolean = process.versions.bun == undefined ? false : true;

export class Logger {
    private formatSettings: Types.LogFormatSettings;
    private storageSettings: Types.LogStorageSettings;
    private webhookSettings: Types.LogWebhookSettings;

    public mainProcess: string;
    public subProcess: string;

    // * Might need to add more types for logMessage
    // TODO add colour theme changing support
    private colours: { [key: string]: Function } = {
        FATAL: chalk.bgRedBright,
        ERROR: chalk.red,
        WARN: chalk.yellow,
        SUCCESS: chalk.green,
        INFO: chalk.blue,
        DEBUG: chalk.magenta,
    };

    private oldLogLocation: string = "";

    private txtWriter: undefined | FileSink;
    private jsonWriter: undefined | FileSink;

    constructor(mainProcess: string, subProcess: string, userSettings: Partial<Types.CustomLoggerSettings> = {}) {
        this.mainProcess = mainProcess;
        this.subProcess = subProcess;

        // Apply Defualt settings
        this.formatSettings = {
            ...defaultSettings.show,
            ...userSettings.show,
        };

        this.storageSettings = {
            ...defaultSettings.logStorage,
            ...userSettings.logStorage,
        };

        this.webhookSettings = {
            ...defaultSettings.logWebook,
            ...userSettings.logWebook,
        };

        this.success(`Initialised Logger, Running in bun? > ${usingBun}`);

        // TODO Change this to use the correct log! And better formatting
        this.debug("Settings:\n" + JSON.stringify(this.formatSettings, null, 4));
        this.debug("\n" + JSON.stringify(this.storageSettings, null, 4));
        this.debug("\n" + JSON.stringify(this.webhookSettings, null, 4) + "\n");

        if (this.storageSettings.stratagy == "batch" && !usingBun) {
            this.fatal("Logger cannot use batch mode when not running in bun");
            process.exit(1);
        }
    }
    private sendLog(logLevel: Types.LogLevel, logMessage: any, logData: any) {
        const currentTime = new Date();
        const formattedDate: string = dateFormat(currentTime, this.formatSettings.dateformat);
        const logMessageString = this.handleLogDatatype(logMessage);
        const logDataString = this.handleLogDatatype(logData);

        const txtLog = this.formTxtLog(formattedDate, logMessageString, logLevel, logDataString);

        if (this.formatSettings.stdoutEnable && !this.formatSettings.ignoreLevels.includes(logLevel))
            console.log(this.colours[logLevel](txtLog));
    }

    private formTxtLog(formattedDate: string, logMessage: string, logLevel: string, logDataString: string): string {
        let outMessage = "";
        outMessage += this.formatSettings.date ? `[${formattedDate}] ` : "";

        outMessage += this.formatSettings.mainProgram || this.formatSettings.subProgram ? "<" : "";

        outMessage += this.formatSettings.mainProgram ? this.mainProcess : "";

        outMessage += this.formatSettings.mainProgram && this.formatSettings.subProgram ? "." : "";

        outMessage += this.formatSettings.subProgram ? this.subProcess : "";

        outMessage += this.formatSettings.mainProgram || this.formatSettings.subProgram ? "> " : "";

        outMessage += this.formatSettings.level ? `[${logLevel}] ` : "";

        outMessage += logMessage;

        outMessage += logDataString != "" ? "\nLog Data:\n" + logDataString : "";

        return outMessage;
    }

    private logToFile(
        currentTime: Date,
        formattedDate: string,
        logMessageString: string,
        logLevel: string,
        logDataString: string,
    ) {
        // TODO add filestorage

        // Form log JSON

        const logJSON: Types.LogJSON = {
            date: currentTime,
            formattedDate: formattedDate,
            mainProcess: this.mainProcess,
            subProcess: this.subProcess,
            logLevel: logLevel,
            logMessage: logMessageString,
            logData: logDataString,
        };

        let logJSONString: string;

        try {
            logJSONString = JSON.stringify(logJSON);
        } catch (error) {
            this.error("Error converting logJSON to string", { error: error, data: logJSON });
        }

        let logLocation = this.storageSettings.path;

        switch (this.storageSettings.splitBy) {
            case "don't split":
                logLocation += "logs.";
                break;
            case "year":
                logLocation += `/${currentTime.getFullYear()}.`;
                break;
            case "month":
                logLocation += `/${currentTime.getFullYear()}/${currentTime.getMonth()}.`;
                break;
            case "day":
                logLocation += `/${currentTime.getFullYear()}/${currentTime.getMonth()}/${currentTime.getDate}.`;
                break;
            case "hour":
                logLocation += `/${currentTime.getFullYear()}/${currentTime.getMonth()}/${
                    currentTime.getDate
                }/${currentTime.getHours()}.`;
                break;
            case "minute":
                logLocation += `/${currentTime.getFullYear()}/${currentTime.getMonth()}/${
                    currentTime.getDate
                }/${currentTime.getHours()}/${currentTime.getMinutes()}.`;
                break;
            case "second":
                logLocation += `/${currentTime.getFullYear()}/${currentTime.getMonth()}/${
                    currentTime.getDate
                }/${currentTime.getHours()}/${currentTime.getMinutes()}.`;
                break;
            default:
                this.error("Logger split by value is invalid", this.storageSettings.splitBy);
                break;
        }

        if (this.storageSettings.stratagy == "batch" && this.storageSettings.batch > 1) {
            // Update Log Location
            if (this.oldLogLocation != logLocation) {
                if (this.txtWriter != undefined) this.txtWriter.end();
                if (this.jsonWriter != undefined) this.jsonWriter.end();

                this.txtWriter = Bun.file(logLocation).writer({ highWaterMark: 1024 * 128 }); // Auto flush at 128Kb
                this.jsonWriter = Bun.file(logLocation, { type: "application/json" }).writer({
                    highWaterMark: 1024 * 128,
                }); // Auto flush at 128Kb
            }

            // Write logs
            // if (this.storageSettings.txt && this.txtWriter != undefined) this.txtWriter.write();
        }
    }

    private handleLogDatatype(logData: any): string {
        if (logData == undefined) return "";

        const dataType = typeof logData;

        if (dataType == "string") return logData;

        if (["bigint", "boolean", "number", "symbol", "function"].includes(dataType)) return logData.toString();

        if (dataType == "object") {
            try {
                return JSON.stringify(logData, null, 4);
            } catch (error) {
                this.error("Datatype of object is not json", { dataType: dataType, data: logData });
                return "";
            }
        }

        this.error("Datatype Error", { dataType: dataType, data: logData });
        return "Datatype error";
    }

    // Print methods
    fatal(message: string, data?: any) {
        this.sendLog("FATAL", message, data);
    }

    error(message: string, data?: any) {
        this.sendLog("ERROR", message, data);
    }

    err = this.error;

    warn(message: string, data?: any) {
        this.sendLog("WARN", message, data);
    }

    success(message: string, data?: any) {
        this.sendLog("SUCCESS", message, data);
    }

    // Info and log do the same thing
    info(message: string, data?: any) {
        this.sendLog("INFO", message, data);
    }

    log = this.info;

    debug(message: string, data?: any) {
        this.sendLog("DEBUG", message, data);
    }

    // Closing process
    exit() {
        if (usingBun) {
            if (this.txtWriter != undefined) this.txtWriter.end();
            if (this.jsonWriter != undefined) this.jsonWriter.end();
        }
    }
}
