import { IsOptional, IsString, Length } from 'class-validator';

export class ConfirmarPagamentoDto {
  @IsOptional()
  @IsString()
  @Length(1, 150)
  paymentId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 150)
  preapprovalId?: string;
}
