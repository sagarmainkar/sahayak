"""
Backprop + PyTorch Refresher — run me: python3 backprop_refresher.py
"""
import torch
import torch.nn as nn
import torch.optim as optim

print("=" * 60)
print("1. TENSORS + requires_grad — the root of everything")
print("=" * 60)

x = torch.tensor([2.0, 3.0], requires_grad=True)
w = torch.tensor([0.5, -0.5], requires_grad=True)
b = torch.tensor(1.0, requires_grad=True)

print(f"x  = {x}    (requires_grad={x.requires_grad})")
print(f"w  = {w}")
print(f"b  = {b}")

y = (x * w).sum() + b
print(f"\ny  = sum(x*w) + b = {y.item():.4f}")
print(f"y.grad_fn = {y.grad_fn}")


print("\n" + "=" * 60)
print("2. BACKWARD — one call, all gradients computed")
print("=" * 60)

y.backward()

print(f"∂y/∂x = {x.grad}    ← should be w = [0.5, -0.5]")
print(f"∂y/∂w = {w.grad}    ← should be x = [2.0,  3.0]")
print(f"∂y/∂b = {b.grad}    ← should be 1.0")


print("\n" + "=" * 60)
print("3. GRAPH CLEANUP — zero_grad() or you accumulate")
print("=" * 60)

# Graphs are freed after .backward(). To demonstrate accumulation,
# recreate the computation
y2 = (x * w).sum() + b
y2.backward()
print(f"w.grad after second backward (ACCUMULATED): {w.grad}  ← 2x the first!")
print(f"Without zero_(), grads ADD UP at each step — #1 training loop bug.")

w.grad.zero_()
x.grad.zero_()
b.grad.zero_()
print(f"w.grad after zero_(): {w.grad}")


print("\n" + "=" * 60)
print("4. NO-GRAD CONTEXTS — evaluation / inference")
print("=" * 60)

with torch.no_grad():
    y_eval = (x * w).sum() + b
    print(f"y_eval = {y_eval.item():.4f}")
    print(f"y_eval.grad_fn = {y_eval.grad_fn}")  # None

y_detached = y.detach()
print(f"y_detached.requires_grad = {y_detached.requires_grad}")


print("\n" + "=" * 60)
print("5. MINIMAL TRAINING LOOP — the pattern everywhere")
print("=" * 60)

torch.manual_seed(42)
w_true = torch.tensor([3.0, -2.0])
b_true = torch.tensor(1.0)

X = torch.randn(100, 2)
y_true = X @ w_true + b_true + 0.1 * torch.randn(100)

model = nn.Linear(2, 1)
loss_fn = nn.MSELoss()
optimizer = optim.SGD(model.parameters(), lr=0.01)

print(f"Initial w={model.weight.data}, b={model.bias.data}")

for epoch in range(200):
    y_pred = model(X).squeeze()
    loss = loss_fn(y_pred, y_true)

    optimizer.zero_grad()
    loss.backward()
    optimizer.step()

    if epoch % 40 == 0:
        print(f"Epoch {epoch:3d} | loss={loss.item():.6f}")

print(f"Learned w={model.weight.data.squeeze()}, b={model.bias.data.item():.4f}")
print(f"True    w={w_true},               b={b_true.item():.4f}")


print("\n" + "=" * 60)
print("6. THE MENTAL MODEL — manual gradient check")
print("=" * 60)

x = torch.tensor([2.0, 3.0])
w = torch.tensor([0.1, 0.1], requires_grad=True)
target = torch.tensor(1.0)

y = (x * w).sum()
loss = (y - target) ** 2
print(f"Forward:  y={y.item():.3f}, loss={loss.item():.3f}")

loss.backward()
print(f"∂loss/∂w = {w.grad}")
print(f"Manual: 2*(y-target)*x = 2*({y.item()-target.item():.3f})*{x} = {2*(y.item()-target.item())*x}")


print("\n" + "=" * 60)
print("7. WHY THIS MATTERS FOR TRANSFORMERS")
print("=" * 60)

batch, seq_len, d_model = 2, 4096, 1024
act_mem = (batch * seq_len * d_model * 4) / (1024**3)
attn_mem = (batch * 32 * seq_len * seq_len * 4) / (1024**3)
print(f"One activation tensor (batch×seq×d_model): {act_mem:.1f} GB")
print(f"Attention matrix (batch×heads×seq×seq):     {attn_mem:.1f} GB")
print("→ This is why FlashAttention recomputes in backward instead of storing.")
print("→ This is why you understand .backward() before touching transformers.")

print("\nDone.")
