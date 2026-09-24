# Developer Setup

Follow these steps to set up the Panch project locally.

## Prerequisites
- Node.js 20 (use `nvm use` or `fnm use` - see `.nvmrc`)
- AWS CLI v2
- AWS CDK CLI (`npm i -g aws-cdk`)

## 1. Install Dependencies
Run from the root of the repository:
```bash
npm install
```
This will install all workspace dependencies across `/infra`, `/services`, `/web`, and `/bench`.

## 2. AWS SSO Configuration
You need access to the team's AWS environment.
1. Run `aws configure sso`
2. Session name: `panch`
3. SSO start URL: (Ask Arshvir)
4. Region: (Ask Arshvir)
5. Select the account `890742603792` and the assigned role.
6. Profile name: `panch`

Always export your profile and region before working:
```bash
export AWS_PROFILE=panch
export AWS_REGION=us-east-1
```
*(On Windows PowerShell, use `$env:AWS_PROFILE="panch"`; `$env:AWS_REGION="us-east-1"`)*

## 3. Running the Mock Server
To work on the frontend or test tribunal logic without a live API or DB:
```bash
cd services/shared
npm run dev:mock
```
The server will run on `http://localhost:4000`. 
- Fetch a created case: `GET http://localhost:4000/cases/c-100?state=CREATED`
- Fetch a deliberating case with timeline: `GET http://localhost:4000/cases/c-100?state=DELIBERATING`

## 4. Running Tests
Run unit tests for shared logic:
```bash
cd services/shared
npm run test
```

To run linting and typechecking across all workspaces:
```bash
npm run lint
npm run typecheck
```
