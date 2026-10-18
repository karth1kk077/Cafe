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

# Login waiter
$body = @{ email="waiter@cafe.local"; password="Password123!" } | ConvertTo-Json
$login = Invoke-RestMethod -Uri "$base/auth/login" -Method POST -Body $body -ContentType "application/json"
Check "Waiter login" ($login.token -ne $null) "role=$($login.user.role)"
$wtoken = $login.token
$H = @{ Authorization = "Bearer $wtoken" }

# Open session on table 1
$tableInfo = Invoke-RestMethod "$base/public/tables/$token1"
$tableId = $tableInfo.table.id
$sess = Invoke-RestMethod -Uri "$base/staff/tables/$tableId/sessions" -Method POST -Headers $H -Body "{}" -ContentType "application/json"
Check "Open session" ($sess.session.status -eq "ACTIVE") "status=$($sess.session.status)"
$sid = $sess.session.id

# Customer places an order (server computes price from catalog; client sends no prices)
$orderPayload = @{
  tableCode = $token1
  idempotencyKey = "smoke-key-001"
  items = @(@{ menuItemId=$latteId; variantId="20000000-0000-4000-8000-000000000002"; addonIds=@("30000000-0000-4000-8000-000000000001"); quantity=2; specialInstructions="no sugar" })
} | ConvertTo-Json -Depth 5
$order = Invoke-RestMethod -Uri "$base/public/orders" -Method POST -Body $orderPayload -ContentType "application/json"
# latte base 18000 + large 4000 + extra shot 3000 = 25000 per unit * 2 = 50000 subtotal; tax 5% = 2500; total 52500
Check "Order created with server price" ($order.order.totalMinor -eq 52500) "total=$($order.order.totalMinor) expected=52500"
Check "Order snapshot name" ($order.order.items[0].nameSnapshot -like "*Latte*") "name=$($order.order.items[0].nameSnapshot)"
Check "Order addon snapshot" ($order.order.items[0].addons.Count -eq 1)
$orderId = $order.order.id

# Idempotency: retry same key returns SAME order id
$order2 = Invoke-RestMethod -Uri "$base/public/orders" -Method POST -Body $orderPayload -ContentType "application/json"
Check "Idempotent retry same order id" ($order2.order.id -eq $orderId) "id=$($order2.order.id)"

# Price tamper: client sends bogus total in a separate field is ignored (schema strips unknown; total is server-derived)
# Attempt to pass a fake price by adding a totalMinor field — schema ignores it, order still uses server price
$tamperPayload = $orderPayload | ConvertFrom-Json
$tamperPayload.idempotencyKey = "smoke-key-tamper"
$tamperPayload | Add-Member -NotePropertyName "totalMinor" -NotePropertyValue 1 -Force
$tamper = Invoke-RestMethod -Uri "$base/public/orders" -Method POST -Body ($tamperPayload | ConvertTo-Json -Depth 5) -ContentType "application/json"
Check "Client price tamper ignored" ($tamper.order.totalMinor -eq 52500) "total=$($tamper.order.totalMinor) (still server-priced)"
# Serve the tamper order as well so the session has no unresolved orders at close time.
$tamperId = $tamper.order.id
Invoke-RestMethod -Uri "$base/staff/orders/$tamperId/status" -Method PATCH -Headers $H -Body '{"status":"ACCEPTED"}' -ContentType "application/json" | Out-Null
Invoke-RestMethod -Uri "$base/staff/orders/$tamperId/status" -Method PATCH -Headers $H -Body '{"status":"PREPARING"}' -ContentType "application/json" | Out-Null
Invoke-RestMethod -Uri "$base/staff/orders/$tamperId/status" -Method PATCH -Headers $H -Body '{"status":"READY"}' -ContentType "application/json" | Out-Null
Invoke-RestMethod -Uri "$base/staff/orders/$tamperId/status" -Method PATCH -Headers $H -Body '{"status":"SERVED"}' -ContentType "application/json" | Out-Null

# Kitchen updates status: PENDING -> ACCEPTED -> PREPARING -> READY -> SERVED
$Hk = $H
Invoke-RestMethod -Uri "$base/staff/orders/$orderId/status" -Method PATCH -Headers $Hk -Body '{"status":"ACCEPTED"}' -ContentType "application/json" | Out-Null
Invoke-RestMethod -Uri "$base/staff/orders/$orderId/status" -Method PATCH -Headers $Hk -Body '{"status":"PREPARING"}' -ContentType "application/json" | Out-Null
Invoke-RestMethod -Uri "$base/staff/orders/$orderId/status" -Method PATCH -Headers $Hk -Body '{"status":"READY"}' -ContentType "application/json" | Out-Null
$finalOrder = Invoke-RestMethod -Uri "$base/staff/orders/$orderId/status" -Method PATCH -Headers $Hk -Body '{"status":"SERVED"}' -ContentType "application/json"
Check "Order transitioned to SERVED" ($finalOrder.order.status -eq "SERVED") "status=$($finalOrder.order.status)"

# Invalid transition should be rejected: SERVED -> PREPARING
try {
  Invoke-RestMethod -Uri "$base/staff/orders/$orderId/status" -Method PATCH -Headers $Hk -Body '{"status":"PREPARING"}' -ContentType "application/json" | Out-Null
  Check "Invalid transition rejected" $false "(no error thrown)"
} catch {
  Check "Invalid transition rejected" ($_.Exception.Response.StatusCode.value__ -eq 409) "status=$($_.Exception.Response.StatusCode.value__)"
}

# Generate bill and record payment. Session has 2 orders (original + tamper) = 105000 total.
$bill = Invoke-RestMethod -Uri "$base/staff/bills/generate" -Method POST -Headers $H -Body (@{sessionId=$sid} | ConvertTo-Json) -ContentType "application/json"
Check "Bill generated (2 orders)" ($bill.bill.totalMinor -eq 105000) "total=$($bill.bill.totalMinor) expected=105000"
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

# CRITICAL: post-closure order attempt must be rejected
try {
  $latePayload = @{
    tableCode = $token1
    idempotencyKey = "smoke-key-late"
    items = @(@{ menuItemId=$latteId; quantity=1 })
  } | ConvertTo-Json -Depth 5
  Invoke-RestMethod -Uri "$base/public/orders" -Method POST -Body $latePayload -ContentType "application/json" | Out-Null
  Check "Post-closure order REJECTED" $false "(order was accepted - BUG)"
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  Check "Post-closure order REJECTED" ($code -eq 409) "status=$code (expected 409)"
}

# Stale tab / saved QR: canOrder must be false after close
$afterClose = Invoke-RestMethod "$base/public/tables/$token1"
Check "canOrder=false after close (saved QR)" ($afterClose.canOrder -eq $false) "canOrder=$($afterClose.canOrder)"

# Unauthorized: customer token cannot access staff endpoint
try {
  Invoke-RestMethod -Uri "$base/staff/tables" -Method GET -Headers $H | Out-Null
  # waiter CAN access; test unauthenticated instead
} catch {}
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
