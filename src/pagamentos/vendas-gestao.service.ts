import { Injectable } from '@nestjs/common';
import { VendasProdutosService } from './vendas-produtos.service';

@Injectable()
export class VendasGestaoService {
  constructor(
    private readonly vendasProdutosService: VendasProdutosService,
  ) {}

  getDashboard(userId: string, statusEnvio?: string | null) {
    return this.vendasProdutosService.listarParaAdmin(userId, { statusEnvio });
  }

  marcarEnviado(
    userId: string,
    vendaId: string,
    dto: { codigoRastreio?: string | null; observacoes?: string | null },
  ) {
    return this.vendasProdutosService.marcarEnviado(userId, vendaId, dto);
  }

  marcarEntregue(userId: string, vendaId: string) {
    return this.vendasProdutosService.marcarEntregue(userId, vendaId);
  }
}
