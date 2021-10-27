/* eslint-disable guard-for-in,no-restricted-syntax */
import type { AWS } from "@serverless/typescript"
import { readdirSync } from "fs"
import { resolve } from "path"

import env from "./env"

const SERVICE_NAME = "raise-server"
const STAGE = "dev" // TODO: sort out the stage correctly
process.env.STAGE = STAGE

// eslint-disable-next-line import/first
import { Table, tables } from "./src/helpers/tables"

const allowedMethods = ["get", "post", "patch", "put", "delete"]

const envCase = (s: string): string => s.replace(/[/_\- ]+/g, () => "_").toUpperCase()
const camelCase = (s: string): string => s.replace(/[/_\- ]+([a-zA-Z])/g, (g) => g.charAt(g.length - 1).toUpperCase())
const pascalCase = (s: string): string => s.replace(/(^|[/_\- ]+)([a-zA-Z])/g, (g) => g.charAt(g.length - 1).toUpperCase())

const createResources = (definitions: Record<string, Table<any, any, any>>): NonNullable<NonNullable<AWS["resources"]>["Resources"]> => Object.values(definitions).reduce<NonNullable<NonNullable<AWS["resources"]>["Resources"]>>((acc, table) => {
  const resourceKey = `${pascalCase(table.entityName)}Table`
  if (acc[resourceKey] !== undefined) throw new Error(`Duplciate table resource key ${resourceKey}`)
  acc[resourceKey] = {
    Type: "AWS::DynamoDB::Table",
    DeletionPolicy: STAGE === "dev" ? "Delete" : "Retain",
    Properties: {
      AttributeDefinitions: [{
        AttributeName: table.partitionKey,
        AttributeType: "S", // String
      }, ...(table.primaryKey !== table.partitionKey ? [{
        AttributeName: table.primaryKey,
        AttributeType: "S", // String
      }] : [])],
      KeySchema: [{
        AttributeName: table.partitionKey,
        KeyType: "HASH",
      }, ...(table.primaryKey !== table.partitionKey ? [{
        AttributeName: table.primaryKey,
        KeyType: "RANGE",
      }] : [])],
      BillingMode: "PAY_PER_REQUEST",
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: STAGE !== "dev",
      },
      TableName: table.name,
    },
  }

  return acc
}, {})

const tableResources = createResources(tables)

const recursivelyFindFunctionsIn = (basePath: string, path: string = basePath): NonNullable<AWS["functions"]> => {
  const result: AWS["functions"] = {}
  const files = readdirSync(path, { withFileTypes: true })
  for (const file of files) {
    if (file.name.startsWith("_")) {
      // ignore
    } else if (file.isFile()) {
      const method = file.name.slice(0, file.name.lastIndexOf("."))
      if (!allowedMethods.includes(method)) {
        throw new Error(`Unexpected method ${method} at path ${path} found when scanning for functions`)
      }

      const relativePath = ((`${path}/`).slice(basePath.length + 1) + method)

      const name = camelCase(relativePath.replace(/\{.*?\}/g, ""))
      result[name] = {
        handler: `src/api/${relativePath}.main`,
        events: [
          {
            httpApi: {
              method,
              path: path.slice(basePath.length),
            },
          },
        ],
      }
    } else if (file.isDirectory()) {
      Object.assign(result, recursivelyFindFunctionsIn(basePath, resolve(path, file.name)))
    } else {
      throw new Error(`Unexpected file ${file.name} at path ${path} found when scanning for functions`)
    }
  }
  return result
}

const functions = recursivelyFindFunctionsIn(resolve(__dirname, "src", "api"))

const serverlessConfiguration: AWS = {
  service: SERVICE_NAME,
  frameworkVersion: "2",
  custom: {
    webpack: {
      webpackConfig: "./webpack.config.js",
      includeModules: {
        forceExclude: [
          // When the aws-sdk v3 is included in the lambda environment, we should exclude all of it
          "@aws-sdk/types",
        ],
      },
    },
    "serverless-offline": {
      httpPort: 8001,
      websocketPort: 8002,
      lambdaPort: 8003,
    },
    dynamodb: { // serverless-dynamodb-local
      stages: [STAGE], // https://github.com/99x/serverless-dynamodb-local/issues/225
      start: {
        port: 8004,
        migrate: true,
        seed: true,
      },
      seed: {
        sample: {
          sources: [{
            table: tables.fundraiser.name,
            sources: ["./local/table_fundraiser.json"],
          }, {
            table: tables.donation.name,
            sources: ["./local/table_donation.json"],
          }, {
            table: tables.payment.name,
            sources: ["./local/table_payment.json"],
          }, {
            table: tables.auditLog.name,
            sources: ["./local/table_auditLog.json"],
          }],
        },
      },
    },
  },
  plugins: [
    "serverless-webpack",
    "serverless-dynamodb-local",
    "serverless-offline",
  ],
  provider: {
    name: "aws",
    runtime: "nodejs14.x",
    region: "eu-west-1",
    stage: STAGE,
    apiGateway: {
      minimumCompressionSize: 1024,
      shouldStartNameWithService: true,
    },
    httpApi: {
      payload: "2.0",
      cors: true,
    },
    environment: {
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
      STAGE,
      ...env,
    },
    lambdaHashingVersion: "20201221",
    memorySize: 256,
    timeout: 10,
    iam: {
      role: {
        statements: Object.keys(tableResources).map((cloudformationName) => ({
          Effect: "Allow",
          Action: "dynamodb:*",
          Resource: {
            "Fn::GetAtt": [cloudformationName, "Arn"],
          },
        })),
      },
    },
  },
  functions,
  resources: {
    Resources: {
      // Using multiple DynamoDB tables as a concious choice for maintainability.
      // The docs promote a single-table design - for max perf/min costs this may
      // be the case, however for us database access time and DynamoDB costs are
      // not limiting factors. Instead, simplicity and maintainability are so a
      // multiple table design makes sense. As we're using on-demand mode billing
      // (as opposed to provisioned capacity) the costs aren't much higher.
      ...tableResources,
    },
  },
}

module.exports = serverlessConfiguration
