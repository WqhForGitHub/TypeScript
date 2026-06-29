# RESTful API 模拟器

一个使用纯 TypeScript 编写的 RESTful API 模拟器，支持路由定义、中间件、请求/响应处理、CRUD 操作、分页查询、数据验证和认证等功能。

## 功能特性

- **路由系统**：支持 GET / POST / PUT / PATCH / DELETE 等 HTTP 方法，支持路径参数（如 `/users/:id`）
- **中间件机制**：全局中间件和路由级中间件，支持洋葱模型（依次调用 next）
- **内置中间件**：日志、CORS、认证、响应计时
- **RESTful 资源控制器**：`app.resource()` 一键注册 CRUD 五个端点
- **分页查询**：列表接口自动支持 `page` / `pageSize` 参数和过滤
- **数据验证**：可自定义验证函数，返回 422 错误详情
- **错误处理**：404 路由不存在、400 参数错误、401 未认证、500 服务器错误
- **种子数据**：预填充用户和文章数据

## 项目结构

```
42. RESTful API 模拟器/
  ├── src/
  │   └── index.ts          # 主源码（全部实现）
  ├── dist/                  # 编译输出
  ├── package.json
  ├── tsconfig.json
  └── README.md
```

## 安装依赖

```bash
npm install
```

## 构建

```bash
npm run build
```

## 运行

```bash
npm start
```

启动后服务器监听 `http://localhost:3000`，并自动运行 15 个演示请求。

## API 端点

### 基础

| 方法 | 路径    | 说明     |
| ---- | ------- | -------- |
| GET  | /       | API 概览 |
| GET  | /health | 健康检查 |

### 用户 (/api/users)

| 方法   | 路径           | 说明                 |
| ------ | -------------- | -------------------- |
| GET    | /api/users     | 用户列表（支持分页） |
| GET    | /api/users/:id | 用户详情             |
| POST   | /api/users     | 创建用户             |
| PUT    | /api/users/:id | 更新用户             |
| DELETE | /api/users/:id | 删除用户             |

### 文章 (/api/posts)

| 方法   | 路径           | 说明     |
| ------ | -------------- | -------- |
| GET    | /api/posts     | 文章列表 |
| GET    | /api/posts/:id | 文章详情 |
| POST   | /api/posts     | 创建文章 |
| PUT    | /api/posts/:id | 更新文章 |
| DELETE | /api/posts/:id | 删除文章 |

### 管理（需认证）

| 方法 | 路径                 | 说明     |
| ---- | -------------------- | -------- |
| GET  | /api/admin/dashboard | 管理后台 |

## 使用示例

```bash
# 获取用户列表
curl http://localhost:3000/api/users

# 分页查询
curl "http://localhost:3000/api/users?page=1&pageSize=2"

# 获取单个用户
curl http://localhost:3000/api/users/1

# 创建用户
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"测试用户","email":"test@example.com","role":"viewer"}'

# 更新用户
curl -X PUT http://localhost:3000/api/users/1 \
  -H "Content-Type: application/json" \
  -d '{"name":"新名字","email":"new@example.com","role":"editor"}'

# 删除用户
curl -X DELETE http://localhost:3000/api/users/1

# 访问需要认证的接口
curl http://localhost:3000/api/admin/dashboard \
  -H "Authorization: Bearer demo-key"
```

## TypeScript 知识点演示

- **类型别名与联合类型**：`HttpMethod`、`Middleware` 等类型定义
- **接口定义**：`HttpRequest`、`HttpResponse`、`Context`、`ResourceController`
- **泛型**：`CrudController<T>` 泛型控制器、`PaginatedResponse<T>` 泛型响应
- **类与继承**：`Router`、`Application`、`CrudController`、`AutoIncrementId`
- **接口实现**：`CrudController implements ResourceController`
- **Record 工具类型**：`Headers`、`RouteParams`、`QueryParams`
- **async/await**：中间件链、请求处理的异步流程
- **类型守卫**：`typeof`、`Array.isArray` 等运行时类型检查
- **可选属性与默认值**：验证函数返回值、分页参数
- **只读类型**：`ReadonlyArray`、`Readonly<Route>` 路由列表返回
