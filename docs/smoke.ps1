$ErrorActionPreference = "Stop"
$base = "http://localhost:4000/api"
# Fetch a live table token from the DB so the test is robust across re-seeds.
$token1 = (psql -U postgres -h localhost -d cafe_db -t -A -f "C:\Users\Karth\Desktop\cafe\docs\gettoken.sql").Trim()
$latteId = "10000000-0000-4000-8000-000000000002"
$results = @()

function Check($name, $cond, $detail="") {
  $status = if ($cond) { "PASS" } else { "FAIL" }
  $script:results += "[$status] $name $detail"
  Write-Output "[$status] $name $detail"
}

# Login staff. Chef drives QUEUED->PREPARING->READY; waiter drives READY->SERVED + billing.
$login = Invoke-RestMethod -Uri "$base/auth/login" -Method POST -Body (@{ email="waiter@cafe.local"; password="Password123!" } | ConvertTo-Json) -ContentType "application/json"
Check "Waiter login" ($login.token -ne $null) "role=$($login.user.role)"
$wtoken = $login.token
$H = @{ Authorization = "Bearer $wtoken" }

$clogin = Invoke-RestMethod -Uri "$base/auth/login" -Method POST -Body (@{ email="chef@cafe.local"; password="Password123!" } | ConvertTo-Json) -ContentType "application/json"
Check "Chef login" ($clogin.token -ne $null) "role=$($clogin.user.role)"
$ctoken = $clogin.token
$Hc = @{ Authorization = "Bearer $ctoken" }

# Open session on the table.
$tableInfo = Invoke-RestMethod "$base/public/tables/$token1"
$tableId = $tableInfo.table.id
$sess = Invoke-RestMethod -Uri "$base/staff/tables/$tableId/sessions" -Method POST -Headers $H -Body "{}" -ContentType "application/json"
Check "Open session" ($sess.session.status -eq "ACTIVE") "status=$($sess.session.status)"
$sid = $sess.session.id

# The API now mints a session-scoped token once the session is orderable.
$tableInfo = Invoke-RestMethod "$base/public/tables/$token1"
$stoken = $tableInfo.sessionToken
Check "Session token minted" ($stoken -ne $null -and $stoken.Length -gt 0)
$SC = @{ "x-session-token" = $stoken }

# Customer places an order (server computes price from catalog; client sends no prices/table).
$orderPayload = @{
  idempotencyKey = "smoke-key-001"
  items = @(@{ menuItemId=$latteId; variantId="20000000-0000-4000-8000-000000000002"; addonIds=@("30000000-0000-4000-8000-000000000001"); quantity=2; specialInstructions="no sugar" })
} | ConvertTo-Json -Depth 5
$order = Invoke-RestMethod -Uri "$base/public/orders" -Method POST -Headers $SC -Body $orderPayload -ContentType "application/json"
# latte base 18000 + large 4000 + extra shot 3000 = 25000 per unit * 2 = 50000 subtotal; tax 5% = 2500; total 52500
Check "Order created with server price" ($order.order.totalMinor -eq 52500) "total=$($order.order.totalMinor) expected=52500"
Check "Order snapshot name" ($order.order.items[0].nameSnapshot -like "*Latte*") "name=$($order.order.items[0].nameSnapshot)"
Check "Order addon snapshot" ($order.order.items[0].addons.Count -eq 1)
Check "Item starts QUEUED" ($order.order.items[0].status -eq "QUEUED") "status=$($order.order.items[0].status)"
Check "Order summary starts RECEIVED" ($order.order.status -eq "RECEIVED") "status=$($order.order.status)"
$orderId = $order.order.id
$itemId = $order.order.items[0].id

# Idempotency: retry same key returns SAME order id
$order2 = Invoke-RestMethod -Uri "$base/public/orders" -Method POST -Headers $SC -Body $orderPayload -ContentType "application/json"
Check "Idempotent retry same order id" ($order2.order.id -eq $orderId) "id=$($order2.order.id)"

# Price tamper: a client-sent totalMinor is stripped by the schema and ignored.
$tamperPayload = $orderPayload | ConvertFrom-Json
$tamperPayload.idempotencyKey = "smoke-key-tamper"
$tamperPayload | Add-Member -NotePropertyName "totalMinor" -NotePropertyValue 1 -Force
$tamper = Invoke-RestMethod -Uri "$base/public/orders" -Method POST -Headers $SC -Body ($tamperPayload | ConvertTo-Json -Depth 5) -ContentType "application/json"
Check "Client price tamper ignored" ($tamper.order.totalMinor -eq 52500) "total=$($tamper.order.totalMinor) (still server-priced)"
$tamperId = $tamper.order.id
$tamperItemId = $tamper.order.items[0].id

# Chef starts the tamper-order item, then readies it; waiter serves it.
Invoke-RestMethod -Uri "$base/staff/order-items/$tamperItemId/status" -Method PATCH -Headers $Hc -Body '{"status":"PREPARING"}' -ContentType "application/json" | Out-Null
Invoke-RestMethod -Uri "$base/staff/order-items/$tamperItemId/status" -Method PATCH -Headers $Hc -Body '{"status":"READY"}' -ContentType "application/json" | Out-Null
Invoke-RestMethod -Uri "$base/staff/order-items/$tamperItemId/status" -Method PATCH -Headers $H -Body '{"status":"SERVED"}' -ContentType "application/json" | Out-Null

# Per-item lifecycle on the main order: QUEUED -> PREPARING -> READY -> SERVED.
Invoke-RestMethod -Uri "$base/staff/order-items/$itemId/status" -Method PATCH -Headers $Hc -Body '{"status":"PREPARING"}' -ContentType "application/json" | Out-Null
$ready = Invoke-RestMethod -Uri "$base/staff/order-items/$itemId/status" -Method PATCH -Headers $Hc -Body '{"status":"READY"}' -ContentType "application/json"
Check "Item READY -> order READY" ($ready.order.status -eq "READY") "order=$($ready.order.status)"

# Waiter sees the per-dish ready queue.
$queue = Invoke-RestMethod -Uri "$base/staff/order-items/ready" -Method GET -Headers $H
Check "Ready queue lists item" (($queue.items | Where-Object { $_.id -eq $itemId }).Count -eq 1)

$served = Invoke-RestMethod -Uri "$base/staff/order-items/$itemId/status" -Method PATCH -Headers $H -Body '{"status":"SERVED"}' -ContentType "application/json"
Check "Item SERVED -> order COMPLETED" ($served.order.status -eq "COMPLETED") "order=$($served.order.status)"

# Invalid transition should be rejected: SERVED item -> PREPARING
try {
  Invoke-RestMethod -Uri "$base/staff/order-items/$itemId/status" -Method PATCH -Headers $Hc -Body '{"status":"PREPARING"}' -ContentType "application/json" | Out-Null
  Check "Invalid item transition rejected" $false "(no error thrown)"
} catch {
  Check "Invalid item transition rejected" ($_.Exception.Response.StatusCode.value__ -eq 409) "status=$($_.Exception.Response.StatusCode.value__)"
}

# Role enforcement: chef cannot mark a dish SERVED (waiter-only); use a fresh item.
$rolePayload = @{ idempotencyKey = "smoke-key-role"; items = @(@{ menuItemId=$latteId; quantity=1 }) } | ConvertTo-Json -Depth 5
$roleOrder = Invoke-RestMethod -Uri "$base/public/orders" -Method POST -Headers $SC -Body $rolePayload -ContentType "application/json"
$roleItemId = $roleOrder.order.items[0].id
Invoke-RestMethod -Uri "$base/staff/order-items/$roleItemId/status" -Method PATCH -Headers $Hc -Body '{"status":"PREPARING"}' -ContentType "application/json" | Out-Null
Invoke-RestMethod -Uri "$base/staff/order-items/$roleItemId/status" -Method PATCH -Headers $Hc -Body '{"status":"READY"}' -ContentType "application/json" | Out-Null
try {
  Invoke-RestMethod -Uri "$base/staff/order-items/$roleItemId/status" -Method PATCH -Headers $Hc -Body '{"status":"SERVED"}' -ContentType "application/json" | Out-Null
  Check "Chef cannot serve (403)" $false "(allowed)"
} catch {
  Check "Chef cannot serve (403)" ($_.Exception.Response.StatusCode.value__ -eq 403) "status=$($_.Exception.Response.StatusCode.value__)"
}
# Waiter serves it so the session can close cleanly.
Invoke-RestMethod -Uri "$base/staff/order-items/$roleItemId/status" -Method PATCH -Headers $H -Body '{"status":"SERVED"}' -ContentType "application/json" | Out-Null

# Generate bill and record payment. Three fully-served orders = 52500 * 3 = 157500.
$bill = Invoke-RestMethod -Uri "$base/staff/bills/generate" -Method POST -Headers $H -Body (@{sessionId=$sid} | ConvertTo-Json) -ContentType "application/json"
Check "Bill generated (3 orders)" ($bill.bill.totalMinor -eq 157500) "total=$($bill.bill.totalMinor) expected=157500"
$billId = $bill.bill.id
# Overpayment must be rejected.
try {
  Invoke-RestMethod -Uri "$base/staff/payments" -Method POST -Headers $H -Body (@{billId=$billId; amountMinor=999999; method="CASH"} | ConvertTo-Json) -ContentType "application/json" | Out-Null
  Check "Overpayment rejected" $false "(accepted)"
} catch {
  Check "Overpayment rejected" ($_.Exception.Response.StatusCode.value__ -eq 409) "status=$($_.Exception.Response.StatusCode.value__)"
}
$pay = Invoke-RestMethod -Uri "$base/staff/payments" -Method POST -Headers $H -Body (@{billId=$billId; amountMinor=$bill.bill.totalMinor; method="CASH"} | ConvertTo-Json) -ContentType "application/json"
Check "Payment recorded, bill PAID" ($pay.bill.status -eq "PAID") "status=$($pay.bill.status)"

# Close session
$close = Invoke-RestMethod -Uri "$base/staff/sessions/$sid/close" -Method POST -Headers $H -Body "{}" -ContentType "application/json"
Check "Session closed" ($close.session.status -eq "CLOSED") "status=$($close.session.status)"

# CRITICAL: the stale session token must be rejected after closure.
try {
  $latePayload = @{ idempotencyKey = "smoke-key-late"; items = @(@{ menuItemId=$latteId; quantity=1 }) } | ConvertTo-Json -Depth 5
  Invoke-RestMethod -Uri "$base/public/orders" -Method POST -Headers $SC -Body $latePayload -ContentType "application/json" | Out-Null
  Check "Post-closure order REJECTED" $false "(order was accepted - BUG)"
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  Check "Post-closure order REJECTED" ($code -eq 409) "status=$code (expected 409)"
}

# Stale tab / saved QR: canOrder must be false after close.
$afterClose = Invoke-RestMethod "$base/public/tables/$token1"
Check "canOrder=false after close (saved QR)" ($afterClose.canOrder -eq $false) "canOrder=$($afterClose.canOrder)"

# Unauthorized: waiter blocked from admin endpoint.
try {
  Invoke-RestMethod -Uri "$base/staff/admin/users" -Method GET -Headers $H | Out-Null
  Check "Waiter blocked from admin users" $false "(accessed)"
} catch {
  Check "Waiter blocked from admin users" ($_.Exception.Response.StatusCode.value__ -eq 403) "status=$($_.Exception.Response.StatusCode.value__)"
}

# Unauthenticated staff access rejected
try {
  Invoke-RestMethod -Uri "$base/staff/tables" -Method GET | Out-Null
  Check "Unauthenticated staff rejected" $false "(accessed)"
} catch {
  Check "Unauthenticated staff rejected" ($_.Exception.Response.StatusCode.value__ -eq 401) "status=$($_.Exception.Response.StatusCode.value__)"
}

Write-Output "`n==== SUMMARY ===="
$pass = ($results | Where-Object { $_ -like "*[[]PASS[]]*" }).Count
$fail = ($results | Where-Object { $_ -like "*[[]FAIL[]]*" }).Count
Write-Output "PASS=$pass FAIL=$fail"
if ($fail -gt 0) { exit 1 }
