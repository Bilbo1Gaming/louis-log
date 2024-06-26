import chalk from "chalk";
import dateFormat from "dateformat";
import * as Types from "./types";
import * as fs from "node:fs";
import fetch from "node-fetch";

import "dotenv/config";

const defaultSettings: Types.LoggerSettings = {
    show: {
        stdoutEnable: true,
        mainProgram: true,
        subProgram: true,
        date: true,
        dateformat: "yyyy-mm-dd HH:MM:ss:l Z",
        level: true,
        ignoreLevels: process.env.ENVIRONMENT != "DEV" ? ["DEBUG"] : [],
    },
    logStorage: {
        path: "./logs",
        json: true,
        txt: true,
        splitBy: "day",
        stratagy: "batch",
        batch: 6,
        ignoreLevels: process.env.ENVIRONMENT != "DEV" ? ["DEBUG"] : [],
    },
    logWebook: {
        enable: false,
        url: undefined,
        form: "",
    },
};

export default class Logger {
    private formatSettings!: Types.LogFormatSettings;
    private storageSettings!: Types.LogStorageSettings;
    private webhookSettings!: Types.LogWebhookSettings;

    public mainProcess!: string;
    public subProcess!: string;
    public processID!: string;

    // * Might need to add more types for logMessage
    // TODO add colour theme changing support
    private colours: { [key: string]: Function } = {
        FATAL: chalk.bgRedBright,
        FATALRATE: chalk.bgRedBright,
        ERROR: chalk.red,
        WARN: chalk.yellow,
        SUCCESS: chalk.green,
        INFO: chalk.blue,
        DEBUG: chalk.magenta,
    };

    private logBuffer: Types.LogBufferItem[] = [];
    private webhookBuffer: Types.WebhookBufferItem[] = [];

    /**
     * Creates a new Logger
     * @param {string} mainProcess - The name of the main process
     * @param {string} subProcess  - The name of the subprocess sending the message (eg. Database Handler, Web Server)
     * @param {Partial<Types.CustomLoggerSettings>} userSettings - *optional* custom settings
     * @example
        const logger = new louisLog.Logger("Example API", "/users")

        logger.fatal("This is a fatal error");
        logger.error("This is a normal error");
        logger.err("This is a shorthand for error");
        logger.warn("This is a warning");
        logger.success("This is a success message");
        logger.info("This is a normal log message");
        logger.log("This is also a normal log message");
        logger.debug("This is a debug message");
    */
    constructor(mainProcess: string, subProcess: string, userSettings: Partial<Types.CustomLoggerSettings> = {}) {
        // Process tags
        try {
            this.mainProcess = mainProcess;
            this.subProcess = subProcess;
        } catch (error) {
            console.error("There was an issue with initialising process names", error);
            process.exit(1);
        }

        // Apply Defualt settings
        try {
            this.formatSettings = {
                ...defaultSettings.show,
                ...userSettings.show,
            };
        } catch (error) {
            console.error("There was an issue with initialising settings: format Settings", userSettings.show, error);
            process.exit(1);
        }

        try {
            this.storageSettings = {
                ...defaultSettings.logStorage,
                ...userSettings.logStorage,
            };
        } catch (error) {
            console.error(
                "There was an issue with initialising settings: storage Settings",
                userSettings.logStorage,
                error,
            );
            process.exit(1);
        }

        try {
            this.webhookSettings = {
                ...defaultSettings.logWebook,
                ...userSettings.logWebook,
            };
        } catch (error) {
            console.error(
                "There was an issue with initialising settings: webhook Settings",
                userSettings.logWebook,
                error,
            );
            process.exit(1);
        }

        // Finished initialising
        try {
            this.success(`Initialised Logger`);

            this.debug("Settings:\n" + JSON.stringify(this.formatSettings, null, 4));
            this.debug("\n" + JSON.stringify(this.storageSettings, null, 4));
            this.debug("\n" + JSON.stringify(this.webhookSettings, null, 4) + "\n");
        } catch (error) {
            console.error("There was an issue with logging settings");
            process.exit(1);
        }

        try {
            process.on("beforeExit", () => this.exit("Before exit"));
            process.on("exit", () => this.exit("Process exit"));
            process.on("SIGINT", () => this.exit("SIGINT"));
            process.on("SIGTERM", () => this.exit("SIGTERM"));
            process.on("uncaughtException", async (err) => {
                console.error("Uncaught exception:", err);
                await this.exit("uncaughtException");
            });
        } catch (error) {}
    }
    private sendLog(logLevel: Types.LogLevel, logMessage: any, logData: any) {
        try {
            const currentTime = new Date();
            const formattedDate: string = dateFormat(currentTime, this.formatSettings.dateformat);
            const logMessageString = this.handleLogDatatype(logMessage);
            const logDataString = this.handleLogDatatype(logData);

            const txtLog = this.formTxtLog(formattedDate, logMessageString, logLevel, logDataString);

            if (this.formatSettings.stdoutEnable && !this.formatSettings.ignoreLevels.includes(logLevel))
                console.log(this.colours[logLevel](txtLog));

            if (
                (this.storageSettings.json || this.storageSettings.txt) &&
                !this.storageSettings.ignoreLevels.includes(logLevel)
            )
                this.logToFile(currentTime, formattedDate, logMessageString, logLevel, logDataString, txtLog);

            if (this.webhookSettings.enable)
                this.sendWebhook(currentTime, formattedDate, logMessageString, logLevel, logDataString, txtLog);
        } catch (error) {
            console.error("There was an issue logging data", error);
        }
    }
    private sendWebhook(
        currentTime: Date,
        formattedDate: string,
        logMessageString: string,
        logLevel: Types.LogLevel,
        logDataString: string,
        logTxt: string,
    ) {
        if (logLevel == "FATALRATE") return; // ! Very important. This prevents a discord error due to rate limiting from sending another message and further rate limiting.
        if (this.webhookSettings.url == undefined) return;
        if (this.webhookSettings.form != "discord") {
            this.error("Currently only discord webhooks have been implemented");
            return;
        }

        let newEmbed: Types.WebhookBufferItem = {
            title: `<${this.mainProcess}.${this.subProcess}> [${logLevel}] ${logMessageString}`,
            description:
                logDataString != ""
                    ? `\`\`\`json\n${
                          logDataString.length > 4000
                              ? "The data provided is too long for an embed. Check file based or stdout based logs."
                              : logDataString
                      }\n\`\`\``
                    : "",
            color: null,
            footer: { text: formattedDate },
        };

        this.webhookBuffer.push(newEmbed);

        if (this.webhookBuffer.length > 8) {
            this.fatalRate("Webhook Buffer too large to send in one message!", this.webhookBuffer.length);
            this.webhookBuffer = []; // clear buffer :o
            // console.log(this.webhookBuffer); // * DEBUG LOG
            return;
        }
        if (this.webhookBuffer.length == 8) {
            // console.log("req:", {
            //     method: "POST",
            //     headers: {
            //         "Content-Type": "application/json",
            //     },
            //     body: JSON.stringify({
            //         username: `${this.mainProcess}.${this.subProcess}`,
            //         content: null,
            //         embeds: this.webhookBuffer,
            //         attachments: [],
            //     }),
            // }); // * DEBUG LOG
            fetch(this.webhookSettings.url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    username: `${this.mainProcess}.${this.subProcess}`,
                    content: null,
                    embeds: this.webhookBuffer,
                    attachments: [],
                }),
            })
                .then((res) => {
                    if (res.status != 204)
                        this.fatalRate("Unexpected response from webhook", {
                            status: res.status,
                            message: res.statusText,
                        });
                    this.webhookBuffer = []; // clear buffer
                })
                .catch((err) => {
                    this.fatalRate("Webhook failed to send", { error: err });
                });
            this.webhookBuffer = []; // clear buffer
        }
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
        logTxt: string,
    ) {
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

        let logJSONString: string = "";

        try {
            logJSONString = JSON.stringify(logJSON);
        } catch (error) {
            this.error("Error converting logJSON to string", { error: error, data: logJSON });
        }

        // storing
        if (this.storageSettings.stratagy == "batch" && this.storageSettings.batch > 1) {
            // Update buffer
            let bufferLength: number = this.logBuffer.push({ logTXT: logTxt, logJSONString: logJSONString });

            // if we are at batch count, send to file
            if (bufferLength >= this.storageSettings.batch) {
                this.extractBuffer(currentTime);
            }
        } else {
            // send file every time
            let { dirLocation, logLocation } = this.generatePaths(currentTime);

            if (!fs.existsSync(dirLocation)) {
                fs.mkdirSync(dirLocation, { recursive: true });
            }

            if (this.storageSettings.txt) {
                const txtWriteStream = fs.createWriteStream(logLocation + "txt.log", { flags: "a" });
                txtWriteStream.write(logTxt + "\n");
                txtWriteStream.end();
            }

            if (this.storageSettings.json) {
                const jsonWriteStream = fs.createWriteStream(logLocation + "json.log", { flags: "a" });
                jsonWriteStream.write(logJSONString + "\n");
                jsonWriteStream.end();
            }
        }
    }

    private generatePaths(currentTime: Date) {
        let logLocation = "";
        let dirLocation = this.storageSettings.path;
        //        dateformat: "yyyy-mm-dd HH:MM:ss:l Z",
        switch (this.storageSettings.splitBy) {
            case "don't split":
                dirLocation += `/`;
                logLocation += dirLocation + "logs.";
                break;
            case "year":
                dirLocation += `/`;
                logLocation += `${dateFormat(currentTime, "yyyy")}.`;
                break;
            case "month":
                dirLocation += `/${dateFormat(currentTime, "yyyy")}/`;
                logLocation += dirLocation + `${dateFormat(currentTime, "mm")}.`;
                break;
            case "day":
                dirLocation += `/${dateFormat(currentTime, "yyyy/mm")}/`;
                logLocation += dirLocation + `${dateFormat(currentTime, "dd")}.`;
                break;
            case "hour":
                dirLocation += `/${dateFormat(currentTime, "yyyy/mm/dd")}/`;
                logLocation += dirLocation + `${dateFormat(currentTime, "HH")}.`;
                break;
            case "minute":
                dirLocation += `/${dateFormat(currentTime, "yyyy/mm/dd/HH")}/`;
                logLocation += dirLocation + `${dateFormat(currentTime, "MM")}.`;
                break;
            case "second":
                dirLocation += `/${dateFormat(currentTime, "yyyy/mm/dd/HH/MM")}/`;
                logLocation += dirLocation + `${dateFormat(currentTime, "ss")}.`;
                break;
            default:
                this.error("Logger split by value is invalid", this.storageSettings.splitBy);
                break;
        }
        return { dirLocation, logLocation };
    }

    private extractBuffer(currentTime: Date) {
        let { dirLocation, logLocation } = this.generatePaths(currentTime);

        if (!fs.existsSync(dirLocation)) {
            fs.mkdirSync(dirLocation, { recursive: true });
        }

        let txtUnpacked: string = "";
        let jsonUnpacked: string = "";

        let bufferLength = this.logBuffer.length;

        for (let i = 0; i < bufferLength; i++) {
            let logItem = this.logBuffer.shift();
            if (logItem == undefined) {
                this.error("Log buffer item is empty whilst trying to read from it");
            } else {
                txtUnpacked += logItem.logTXT + "\n";
                jsonUnpacked += logItem.logJSONString + "\n";
            }
        }

        if (this.storageSettings.txt) {
            const txtWriteStream = fs.createWriteStream(logLocation + "txt.log", { flags: "a" });
            txtWriteStream.write(txtUnpacked);
            txtWriteStream.end();
        }

        if (this.storageSettings.json) {
            const jsonWriteStream = fs.createWriteStream(logLocation + "json.log", { flags: "a" });
            jsonWriteStream.write(jsonUnpacked);
            jsonWriteStream.end();
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

    fatal(message: any, data?: any) {
        this.sendLog("FATAL", message, data);
    }

    private fatalRate(message: any, data?: any) {
        this.sendLog("FATALRATE", message, data);
    }

    error(message: any, data?: any) {
        this.sendLog("ERROR", message, data);
    }

    err = this.error;

    warn(message: any, data?: any) {
        this.sendLog("WARN", message, data);
    }

    success(message: any, data?: any) {
        this.sendLog("SUCCESS", message, data);
    }

    // Info and log do the same thing
    info(message: any, data?: any) {
        this.sendLog("INFO", message, data);
    }

    log = this.info;

    debug(message: any, data?: any) {
        this.sendLog("DEBUG", message, data);
    }

    // Closing process

    /**
     * Forces a cleanup and exit, use wisely.
     * Automatically called on exit or uncaught exception.
     *
     * Ensures that all logs in memory are dealt with before closing.
     */
    async exit(reason?: string) {
        console.log("Shutting down gracefully with reason: ", reason);
        if (this.storageSettings.stratagy == "batch") {
            console.log("Clearing file buffer, length:", this.logBuffer.length);
            try {
                const currentTime = new Date();
                this.extractBuffer(currentTime);
            } catch (error) {
                console.error("There was an issue clearing the log buffer", error);
            }
        }
        if (this.webhookSettings.url != undefined && this.webhookBuffer.length > 0) {
            console.log("Sending last discord message, length: ", this.webhookBuffer.length);
            // console.error("req:", {
            //     method: "POST",
            //     headers: {
            //         "Content-Type": "application/json",
            //     },
            //     body: JSON.stringify({
            //         username: `${this.mainProcess}.${this.subProcess}`,
            //         content: null,
            //         embeds: this.webhookBuffer,
            //         attachments: [],
            //     }),
            // }); //  * DEBUG LOG

            try {
                await fetch(this.webhookSettings.url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        username: `${this.mainProcess}.${this.subProcess}`,
                        content: null,
                        embeds: this.webhookBuffer,
                        attachments: [],
                    }),
                })
                    .then((res) => {
                        if (res.status != 204) {
                            console.error("Unexpected response from webhook", {
                                status: res.status,
                                message: res.statusText,
                            });
                        }

                        this.webhookBuffer = []; // clear buffer

                        console.log("ready to shutdown");
                    })
                    .catch((err) => {
                        console.error("Webhook failed to send", { error: err });
                    });
            } catch (error) {
                console.error("There was an issue clearing the webhook buffer");
            }
        }
        setTimeout(() => {
            process.exit();
        }, 500);
    }
}
