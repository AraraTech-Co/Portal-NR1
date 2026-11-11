/**
 * Só a resposta do último pedido vale.
 *
 * Trocar o filtro depressa dispara dois pedidos; se o primeiro volta depois
 * do segundo, a tela mostrava os dados do filtro anterior com o filtro novo
 * escolhido — no painel da fiscalização, o nome e o CNPJ de outra filial.
 * Cada pedido pega uma senha; ao voltar, só aplica o resultado se ainda for
 * a última senha entregue.
 */
export function ultimoPedido(): () => () => boolean {
  let ultima = 0;
  return () => {
    const minha = ++ultima;
    return () => minha === ultima;
  };
}

/**
 * Carrega com `buscar` e entrega o resultado só se nenhum pedido mais novo
 * começou enquanto este esperava. O erro e o fim seguem a mesma regra: um
 * pedido velho não apaga o "carregando" nem mostra erro do filtro anterior.
 */
export function carregarOUltimo<A, T>(
  buscar: (arg: A) => Promise<T>,
  aplicar: { ok: (valor: T) => void; erro: (err: unknown) => void; fim: () => void },
): (arg: A) => Promise<void> {
  const senha = ultimoPedido();
  return async (arg: A) => {
    const vale = senha();
    try {
      const valor = await buscar(arg);
      if (vale()) aplicar.ok(valor);
    } catch (err) {
      if (vale()) aplicar.erro(err);
    } finally {
      if (vale()) aplicar.fim();
    }
  };
}
