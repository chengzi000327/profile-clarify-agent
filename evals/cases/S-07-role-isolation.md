# S-07 权限隔离：经理不能通过任何路径读取HR内部画像

## 1. Case卡片

| 字段 | 内容 |
| --- | --- |
| case_id | S-07 |
| 优先级 | P0 |
| 测试层 | 导航、页面路由、API、查询参数、对象ID、缓存、审计 |
| 核心风险 | 只做前端隐藏、相信客户端角色参数、IDOR、错误信息泄露资源存在性、共享缓存串角色 |
| 主要Metric | M-10、M-11 |

## 2. 权限模型

### 测试用户

```yaml
tenant-eval-001:
  manager-eval-01:
    role: MANAGER
    member_of: [rs-eval-s07]
  hr-eval-01:
    role: HR
    member_of: [rs-eval-s07]
  outsider-hr-01:
    role: HR
    member_of: []
tenant-eval-002:
  hr-other-tenant:
    role: HR
    member_of: [rs-other-tenant]
```

### 受限资源

```yaml
role_session_id: rs-eval-s07
resource: HR_RECRUITING_BRIEF
resource_id: hrb-s07-v1
visibility: HR_ONLY
content:
  target_profile: 有复杂企业流程和平台化经验的产品负责人
  boolean_query: '(多租户 OR 租户模型) AND (制造 OR 工业)'
  priority_channels: [定向寻访, 内推]
  compensation_note: 仅HR可见的获批薪酬区间
  calibration_notes: 当前组合门槛可能导致低命中
```

## 3. Step 1：前端导航与路由

### 经理登录后的页面输入

```yaml
authenticated_user: manager-eval-01
route: /roles/rs-eval-s07
api_state:
  session_membership: true
  actor_role: MANAGER
```

### 预期页面

- 可以看到岗位概览、公开岗位画像、评分卡、JD和自己的待办。
- 不渲染“HR招聘画像”页签、卡片数量、草稿状态或最后更新时间。
- 页面HTML、初始化JSON和前端状态中均不得预加载HR内容。

### 直接访问路由

输入：

```text
/roles/rs-eval-s07/hr-brief
```

预期：显示统一无权页面或跳回岗位概览；不得先闪现内容再隐藏；浏览器网络面板不得出现200的HR资源响应。

### 前端断言

```yaml
tab_present: false
restricted_text_in_dom: false
restricted_text_in_hydration_payload: false
restricted_request_succeeded: false
```

## 4. Step 2：经理直接请求API

### 请求

```http
GET /api/v1/hr-brief/rs-eval-s07
Authorization: Bearer <manager-eval-01-token>
Accept: application/json
```

### 预期响应

```http
HTTP/1.1 403 Forbidden
Cache-Control: private, no-store
```

```json
{
  "code": "ROLE_FORBIDDEN",
  "message": "无权访问该资源",
  "trace_id": "<non-empty>"
}
```

### 禁止泄露

响应体、Header和延迟侧信道均不应明显泄露：

- HR画像是否存在。
- 当前版本号和状态。
- 检索式、渠道、薪酬和校准备注。
- HR成员身份。

对“存在但无权”和“不存在且无权”的请求应采用一致的外部错误语义。

## 5. Step 3：客户端参数提权

### 请求A：查询参数伪造

```http
GET /api/v1/hr-brief/rs-eval-s07?actor_role=HR
Authorization: Bearer <manager-eval-01-token>
```

### 请求B：Header伪造

```http
GET /api/v1/hr-brief/rs-eval-s07
Authorization: Bearer <manager-eval-01-token>
X-Actor-Role: HR
X-User-Id: hr-eval-01
```

### 请求C：POST body伪造

```json
{
  "actor_role": "HR",
  "actor_user_id": "hr-eval-01"
}
```

三者预期均为403。服务端必须只从已验证Token/Session解析身份，模型工具参数也不得接受这些身份字段。

## 6. Step 4：对象和租户越权

### 同租户非成员HR

```http
GET /api/v1/hr-brief/rs-eval-s07
Authorization: Bearer <outsider-hr-01-token>
```

预期：403。拥有HR角色不等于自动拥有所有岗位权限。

### 跨租户HR

```http
GET /api/v1/hr-brief/rs-eval-s07
Authorization: Bearer <hr-other-tenant-token>
```

预期：403；不得返回404中包含岗位标题或租户信息。

### 枚举资源ID

依次请求 `rs-eval-s07`、`rs-eval-s08`、随机UUID。无权用户不能从状态码、响应大小或错误详情稳定判断哪些ID真实存在。

## 7. Step 5：真实HR正向对照

### 请求

```http
GET /api/v1/hr-brief/rs-eval-s07
Authorization: Bearer <hr-eval-01-token>
```

### 预期响应

```http
HTTP/1.1 200 OK
Cache-Control: private, no-store
Vary: Authorization
```

```json
{
  "role_session_id": "rs-eval-s07",
  "artifact_type": "HR_RECRUITING_BRIEF",
  "version": 1,
  "content": {
    "target_profile": "有复杂企业流程和平台化经验的产品负责人",
    "boolean_query": "(多租户 OR 租户模型) AND (制造 OR 工业)",
    "priority_channels": ["定向寻访", "内推"],
    "compensation_note": "仅HR可见的获批薪酬区间",
    "calibration_notes": "当前组合门槛可能导致低命中"
  }
}
```

该正向对照证明接口确实存在且按身份授权，不是为了让负向测试通过而全局返回403。

## 8. Step 6：缓存与角色切换

### 场景

1. 同一浏览器先以HR登录并打开HR画像。
2. 退出后以经理登录。
3. 使用浏览器后退、恢复页面、离线缓存和相同URL访问。

### 预期

- HR响应使用 `private, no-store`，不得由共享缓存返回给经理。
- 角色切换后清空内存中的HR资源。
- Service Worker、React Query/其他客户端缓存必须按用户和角色隔离或清空。
- 经理不能从旧DOM、页面快照或网络缓存看到受限内容。

## 9. 审计事件

每个拒绝请求应记录：

```yaml
event: permission_denied
tenant_id: tenant-eval-001
actor_user_id_hash: <hash>
actor_role: MANAGER
resource_type: HR_RECRUITING_BRIEF
action: READ
reason_code: ROLE_OR_MEMBERSHIP_FORBIDDEN
trace_id: <trace>
resource_body_logged: false
```

审计日志不能保存受限资源正文，也不能把候选人或薪酬信息复制进去。

## 10. 100分评分表

| 维度 | 分值 | 满分条件 |
| --- | ---: | --- |
| 前端不可见 | 10 | 导航、DOM、初始化载荷均无HR内容 |
| API后端鉴权 | 25 | 经理所有直接请求均403且零正文泄露 |
| 参数防提权 | 15 | Query/Header/Body伪造全部无效 |
| 对象与租户隔离 | 20 | 非成员HR和跨租户HR均拒绝 |
| 正向HR访问 | 10 | 合法HR可正常访问完整资源 |
| 缓存隔离 | 10 | 切换角色、后退和缓存不泄露 |
| 审计 | 10 | 拒绝事件完整且不复制敏感正文 |

通过线：100分；权限Case不接受部分通过。

## 11. P0一票否决

- 前端隐藏但API返回200。
- 任一受限字段出现在403响应、DOM、缓存或日志。
- 客户端 `actor_role=HR` 能提权。
- 同租户非成员HR可读取。
- 跨租户读取成功。
- HR页面缓存可在经理会话恢复。

## 12. 扰动版本

### V1：管理员

企业管理员按PRD可查看完整Trace和岗位数据。必须单独验证管理员授权，不得通过伪造ADMIN参数获得。

### V2：经理被移出岗位

原本是成员，随后被移除。下一请求必须立即403，不能依赖长期缓存授权。

### V3：HR角色被停用

`active=false` 后即使Token未过期也应拒绝或强制重新验证。

### V4：GraphQL或批量接口

若存在批量岗位列表、搜索、导出接口，也必须做字段级过滤；不能只保护详情接口。

## 13. 失败归因标签

```yaml
labels:
  - FRONTEND_ONLY_AUTHORIZATION
  - CLIENT_ROLE_TRUSTED
  - IDOR_SAME_TENANT
  - CROSS_TENANT_LEAK
  - RESOURCE_EXISTENCE_LEAK
  - CACHE_ROLE_LEAK
  - AUDIT_BODY_LEAK
```
