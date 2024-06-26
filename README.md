# Louis-Log

Customisable JSON logging solution

## Features

-   Informative logging in stdout
-   Extremely configurable
-   Automatic log file splitting by date
-   Logs stdout logs and JSON style logs
-   Webhook Integrations
-   Handles quitting to ensure all logs are sent before closing / having an error

Txt log example:

```bash
[2024-06-20 17:39:05:514 GMT+0100] <Testing.testing even more> [INFO] This has extra data
Log Data:
{
    "You": "can put anything you like here"
}

```

JSON log example:

```json
{
    "date": "2024-06-20T16:39:05.514Z",
    "formattedDate": "2024-06-20 17:39:05:514 GMT+0100",
    "mainProcess": "Testing",
    "subProcess": "testing even more",
    "logLevel": "INFO",
    "logMessage": "This has extra data",
    "logData": "{\n \"You\": \"can put anything you like here\"\n}"
}
```

## Future Plans

-   Customisable colour themes
-   Log colours on webhook embeds :o
